import {join} from 'path';
import type {aws_iam, aws_s3} from 'aws-cdk-lib';
import {aws_apigateway} from 'aws-cdk-lib';
import type {S3Route} from '../stack-config.js';
import {addCorsPreflight} from './add-cors-preflight.js';

export function addS3Resource(
  route: S3Route,
  restApi: aws_apigateway.RestApiBase,
  bucket: aws_s3.IBucket,
  bucketReadRole: aws_iam.IRole,
  requestAuthorizer: aws_apigateway.IAuthorizer | undefined,
): void {
  const {
    type,
    publicPath,
    path,
    authenticationEnabled,
    corsEnabled,
    corsAllowHeaders,
  } = route;

  if (authenticationEnabled && !requestAuthorizer) {
    throw new Error(
      `Authentication cannot be enabled because no authentication options are configured.`,
    );
  }

  const integration = new aws_apigateway.AwsIntegration({
    service: `s3`,
    path:
      type === `folder`
        ? join(bucket.bucketName, path, `{proxy}`)
        : join(bucket.bucketName, path),
    integrationHttpMethod: `GET`,
    options: getS3IntegrationOptions(route, bucketReadRole),
  });

  const corsOptions: aws_apigateway.CorsOptions = {
    allowOrigins: aws_apigateway.Cors.ALL_ORIGINS,
    allowCredentials: authenticationEnabled,
    ...(corsAllowHeaders && {
      allowHeaders:
        aws_apigateway.Cors.DEFAULT_HEADERS.concat(corsAllowHeaders),
    }),
  };

  const methodOptions = getS3MethodOptions(route, requestAuthorizer);

  if (type === `file`) {
    const resource = restApi.root.resourceForPath(
      publicPath.replace(`/*`, `/`),
    );

    if (corsEnabled) {
      addCorsPreflight(resource, corsOptions);
    }

    resource.addMethod(`GET`, integration, methodOptions);
  }

  if (publicPath.endsWith(`/*`)) {
    const proxyResource = restApi.root.resourceForPath(
      publicPath.replace(`/*`, `/{proxy+}`),
    );

    if (corsEnabled) {
      addCorsPreflight(proxyResource, corsOptions);
    }

    proxyResource.addMethod(`GET`, integration, methodOptions);
  }
}

function getS3IntegrationOptions(
  route: S3Route,
  bucketReadRole: aws_iam.IRole,
): aws_apigateway.IntegrationOptions {
  const {type, responseHeaders, corsEnabled} = route;

  const corsResponseParameters: Record<string, string> = corsEnabled
    ? {'method.response.header.Access-Control-Allow-Origin': `'*'`}
    : {};

  const responseParameters = {
    'method.response.header.Content-Type': `integration.response.header.Content-Type`,
    ...corsResponseParameters,
    ...Object.entries(responseHeaders ?? {}).reduce(
      (parameters, [key, value]) => ({
        ...parameters,
        [`method.response.header.${key}`]: `'${value}'`,
      }),
      {} as Record<string, string>,
    ),
  };

  return {
    credentialsRole: bucketReadRole,
    integrationResponses: [
      {
        selectionPattern: `200`,
        statusCode: `200`,
        responseParameters,
      },
      {
        selectionPattern: `404`,
        statusCode: `404`,
        responseParameters: corsResponseParameters,
      },
      {
        selectionPattern: `5\\d{2}`,
        statusCode: `500`,
        responseParameters: corsResponseParameters,
      },
    ],
    requestParameters:
      type === `folder`
        ? {'integration.request.path.proxy': `method.request.path.proxy`}
        : {},
    cacheKeyParameters: type === `folder` ? [`method.request.path.proxy`] : [],
  };
}

function getS3MethodOptions(
  route: S3Route,
  requestAuthorizer: aws_apigateway.IAuthorizer | undefined,
): aws_apigateway.MethodOptions {
  const {type, responseHeaders, authenticationEnabled, corsEnabled} = route;

  const corsResponseParameters: Record<string, boolean> = corsEnabled
    ? {'method.response.header.Access-Control-Allow-Origin': true}
    : {};

  const responseHeaderNames = Object.keys(responseHeaders ?? []);

  const responseParameters = {
    'method.response.header.Content-Type': true,
    ...corsResponseParameters,
    ...responseHeaderNames.reduce(
      (parameters, headerName) => ({
        ...parameters,
        [`method.response.header.${headerName}`]: true,
      }),
      {} as Record<string, boolean>,
    ),
  };

  return {
    authorizationType: authenticationEnabled
      ? aws_apigateway.AuthorizationType.CUSTOM
      : aws_apigateway.AuthorizationType.NONE,
    authorizer: authenticationEnabled ? requestAuthorizer : undefined,
    methodResponses: [
      {statusCode: `200`, responseParameters},
      {statusCode: `404`, responseParameters: corsResponseParameters},
      {statusCode: `500`, responseParameters: corsResponseParameters},
    ],
    requestParameters:
      type === `folder` ? {'method.request.path.proxy': true} : {},
  };
}
