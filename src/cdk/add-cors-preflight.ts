import {
  ContentHandling,
  Cors,
  type CorsOptions,
  type Method,
  MockIntegration,
  type Resource,
} from 'aws-cdk-lib/aws-apigateway';

// mainly copied from  https://github.com/aws/aws-cdk/blob/main/packages/%40aws-cdk/aws-apigateway/lib/resource.ts#L194
// addition:
// set contentHandling: ContentHandling.CONVERT_TO_TEXT in order to fix the issue that preflight requests
// and binarMediaType */* don#t work together
// see: https://github.com/clebert/aws-simple/issues/167
export function addCorsPreflight(
  resource: Resource,
  options: CorsOptions,
): Method {
  const headers: {[name: string]: string} = {};

  //
  // Access-Control-Allow-Headers

  const allowHeaders = options.allowHeaders || Cors.DEFAULT_HEADERS;
  headers[`Access-Control-Allow-Headers`] = `'${allowHeaders.join(`,`)}'`;

  //
  // Access-Control-Allow-Origin

  if (options.allowOrigins.length === 0) {
    throw new Error(`allowOrigins must contain at least one origin`);
  }

  if (options.allowOrigins.includes(`*`) && options.allowOrigins.length > 1) {
    throw new Error(
      `Invalid "allowOrigins" - cannot mix "*" with specific origins: ${options.allowOrigins.join(
        `,`,
      )}`,
    );
  }

  // we use the first origin here and if there are more origins in the list, we
  // will match against them in the response velocity template
  const initialOrigin = options.allowOrigins[0];
  headers[`Access-Control-Allow-Origin`] = `'${initialOrigin}'`;

  // the "Vary" header is required if we allow a specific origin
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin#CORS_and_caching
  if (initialOrigin !== `*`) {
    headers.Vary = `'Origin'`;
  }

  //
  // Access-Control-Allow-Methods

  let allowMethods = options.allowMethods || Cors.ALL_METHODS;

  if (allowMethods.includes(`ANY`)) {
    if (allowMethods.length > 1) {
      throw new Error(
        `ANY cannot be used with any other method. Received: ${allowMethods.join(
          `,`,
        )}`,
      );
    }

    allowMethods = Cors.ALL_METHODS;
  }

  headers[`Access-Control-Allow-Methods`] = `'${allowMethods.join(`,`)}'`;

  //
  // Access-Control-Allow-Credentials

  if (options.allowCredentials) {
    headers[`Access-Control-Allow-Credentials`] = `'true'`;
  }

  //
  // Access-Control-Max-Age

  let maxAgeSeconds;

  if (options.maxAge && options.disableCache) {
    throw new Error(
      `The options "maxAge" and "disableCache" are mutually exclusive`,
    );
  }

  if (options.maxAge) {
    maxAgeSeconds = options.maxAge.toSeconds();
  }

  if (options.disableCache) {
    maxAgeSeconds = -1;
  }

  if (maxAgeSeconds) {
    headers[`Access-Control-Max-Age`] = `'${maxAgeSeconds}'`;
  }

  //
  // Access-Control-Expose-Headers
  //

  if (options.exposeHeaders) {
    headers[`Access-Control-Expose-Headers`] = `'${options.exposeHeaders.join(
      `,`,
    )}'`;
  }

  //
  // statusCode

  const statusCode = options.statusCode ?? 204;

  //
  // prepare responseParams

  const integrationResponseParams: {[p: string]: string} = {};
  const methodResponseParams: {[p: string]: boolean} = {};

  for (const [name, value] of Object.entries(headers)) {
    const key = `method.response.header.${name}`;
    integrationResponseParams[key] = value;
    methodResponseParams[key] = true;
  }

  return resource.addMethod(
    `OPTIONS`,
    new MockIntegration({
      requestTemplates: {'application/json': `{ statusCode: 200 }`},
      integrationResponses: [
        {
          statusCode: `${statusCode}`,
          responseParameters: integrationResponseParams,
          responseTemplates: renderResponseTemplate(),
          contentHandling: ContentHandling.CONVERT_TO_TEXT,
        },
      ],
      contentHandling: ContentHandling.CONVERT_TO_TEXT,
    }),
    {
      methodResponses: [
        {statusCode: `${statusCode}`, responseParameters: methodResponseParams},
      ],
    },
  );

  // renders the response template to match all possible origins (if we have more than one)
  function renderResponseTemplate() {
    const origins = options.allowOrigins.slice(1);

    if (origins.length === 0) {
      return undefined;
    }

    const template = new Array<string>();

    template.push(`#set($origin = $input.params().header.get("Origin"))`);
    template.push(
      `#if($origin == "") #set($origin = $input.params().header.get("origin")) #end`,
    );

    const condition = origins
      .map((o) => `$origin.matches("${o}")`)
      .join(` || `);

    template.push(`#if(${condition})`);
    template.push(
      `  #set($context.responseOverride.header.Access-Control-Allow-Origin = $origin)`,
    );
    template.push(`#end`);

    return {
      'application/json': template.join(`\n`),
    };
  }
}
