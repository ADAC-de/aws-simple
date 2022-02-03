import type {LambdaResourceInit} from './cdk/add-lambda-resource';
import {addLambdaResource} from './cdk/add-lambda-resource';
import type {S3ResourceInit} from './cdk/add-s3-resource';
import {addS3Resource} from './cdk/add-s3-resource';
import {createAccessLogGroup} from './cdk/create-access-log-group';
import {createBucket} from './cdk/create-bucket';
import {createBucketReadRole} from './cdk/create-bucket-read-role';
import {createCertificate} from './cdk/create-certificate';
import {createHostedZone} from './cdk/create-hosted-zone';
import {createLambdaFunction} from './cdk/create-lambda-function';
import {createRecord} from './cdk/create-record';
import {createRequestAuthorizer} from './cdk/create-request-authorizer';
import {createRestApi} from './cdk/create-rest-api';
import {createStack} from './cdk/create-stack';
import {createUnauthorizedGatewayResponse} from './cdk/create-unauthorized-gateway-response';
import type {MethodDeployment} from './cdk/get-stage-options';
import {getStageOptions} from './cdk/get-stage-options';
import type {StackConfig} from './get-stack-config';
import {getHash} from './utils/get-hash';
import {getNormalizedName} from './utils/get-normalized-name';

const fileFunctionProxyName = `proxy`;
const folderProxyName = `folder`;

// eslint-disable-next-line complexity
export function synthesize(stackConfig: StackConfig): void {
  const {
    hostedZoneName,
    subdomainName,
    authentication,
    throttling,
    monitoring: {
      accessLoggingEnabled,
      loggingEnabled,
      metricsEnabled,
      tracingEnabled,
    } = {},
    routes,
    onSynthesize,
  } = stackConfig;

  const domainName = subdomainName
    ? `${subdomainName}.${hostedZoneName}`
    : hostedZoneName;

  // Stack name must match the regular expression: /^[A-Za-z][A-Za-z0-9-]*$/
  // Example: aws-simple-foo-example-com
  const stackName = `aws-simple-${getNormalizedName(domainName)}`;

  // Example: foo-example-com
  const restApiName = getNormalizedName(domainName);

  // Example: aws-simple-request-authorizer-1234567
  const requestAuthorizerFunctionName = `aws-simple-request-authorizer-${getHash(
    domainName,
  )}`;

  // Example: POST-foo-bar-baz-1234567
  const getFunctionName = (httpMethod: string, identifier: string) => {
    const functionName = `${httpMethod}-${getNormalizedName(
      identifier,
    )}-${getHash(domainName)}`;

    if (functionName.length > 64) {
      throw new Error(
        `The name of a Lambda function must not be longer than 64 characters.`,
      );
    }

    return functionName;
  };

  const stack = createStack({stackName});
  const hostedZone = createHostedZone({stack, hostedZoneName});
  const certificate = createCertificate({stack, hostedZone, domainName});
  const methodDeployments: MethodDeployment[] = [];

  for (const route of routes) {
    const {type, publicPath, cacheTtlInSeconds} = route;

    if (type === `file`) {
      methodDeployments.push({
        httpMethod: `GET`,
        publicPath,
        proxyName: undefined,
        cacheTtlInSeconds,
      });
    } else if (type === `file+`) {
      methodDeployments.push(
        {
          httpMethod: `GET`,
          publicPath,
          proxyName: undefined,
          cacheTtlInSeconds,
        },
        {
          httpMethod: `GET`,
          publicPath,
          proxyName: fileFunctionProxyName,
          cacheTtlInSeconds,
        },
      );
    } else if (type === `folder+`) {
      methodDeployments.push({
        httpMethod: `GET`,
        publicPath,
        proxyName: folderProxyName,
        cacheTtlInSeconds,
      });
    } else if (type === `function`) {
      methodDeployments.push({
        httpMethod: route.httpMethod,
        publicPath,
        proxyName: undefined,
        cacheTtlInSeconds,
      });
    } else if (type === `function+`) {
      methodDeployments.push(
        {
          httpMethod: route.httpMethod,
          publicPath,
          proxyName: undefined,
          cacheTtlInSeconds,
        },
        {
          httpMethod: route.httpMethod,
          publicPath,
          proxyName: fileFunctionProxyName,
          cacheTtlInSeconds,
        },
      );
    }
  }

  const stageOptions = getStageOptions({
    accessLogGroup: accessLoggingEnabled
      ? createAccessLogGroup({stack, domainName})
      : undefined,
    methodDeployments,
    throttling,
    loggingEnabled,
    metricsEnabled,
    tracingEnabled,
  });

  const restApi = createRestApi({
    stack,
    certificate,
    restApiName,
    domainName,
    stageOptions,
  });

  if (subdomainName) {
    createRecord({stack, hostedZone, restApi, type: `A`, subdomainName});
    createRecord({stack, hostedZone, restApi, type: `AAAA`, subdomainName});
  }

  const bucket = createBucket({stack});
  const bucketReadRole = createBucketReadRole({stack, bucket});

  const requestAuthorizer =
    authentication &&
    createRequestAuthorizer({
      stack,
      functionName: requestAuthorizerFunctionName,
      username: authentication.username,
      password: authentication.password,
      cacheTtlInSeconds: authentication.cacheTtlInSeconds,
    });

  if (authentication) {
    createUnauthorizedGatewayResponse({
      stack,
      restApi,
      realm: authentication.realm,
      corsEnabled: routes.some(({corsEnabled}) => corsEnabled),
    });
  }

  onSynthesize?.({stack, restApi});

  for (const route of routes) {
    if (route.type === `function` || route.type === `function+`) {
      const {
        type,
        httpMethod,
        publicPath,
        identifier,
        filename,
        memorySize,
        timeoutInSeconds,
        environment,
        requestParameters,
        authenticationEnabled,
        corsEnabled,
      } = route;

      const lambdaFunction = createLambdaFunction({
        stack,
        functionName: getFunctionName(httpMethod, identifier),
        filename,
        memorySize,
        timeoutInSeconds,
        environment,
      });

      const lambdaResourceInit: LambdaResourceInit = {
        restApi,
        lambdaFunction,
        requestAuthorizer: authenticationEnabled
          ? requestAuthorizer
          : undefined,
        httpMethod,
        publicPath,
        proxyName: undefined,
        cacheKeyRequestParameterNames:
          requestParameters &&
          Object.entries(requestParameters)
            .filter(([, {cacheKey}]) => cacheKey)
            .map(([parameterName]) => parameterName),
        requiredRequestParameterNames:
          requestParameters &&
          Object.entries(requestParameters)
            .filter(([, {required}]) => required)
            .map(([parameterName]) => parameterName),
        corsEnabled,
      };

      addLambdaResource(lambdaResourceInit);

      if (type === `function+`) {
        addLambdaResource({
          ...lambdaResourceInit,
          proxyName: fileFunctionProxyName,
        });
      }

      route.onSynthesize?.({stack, restApi, lambdaFunction});
    } else if (
      route.type === `file` ||
      route.type === `file+` ||
      route.type === `folder+`
    ) {
      const {type, publicPath, responseHeaders, corsEnabled} = route;

      const s3ResourceInit: S3ResourceInit = {
        restApi,
        bucketReadRole,
        requestAuthorizer,
        publicPath,
        bucketName: bucket.bucketName,
        bucketPath: type === `folder+` ? route.dirname : route.filename,
        proxy: undefined,
        responseHeaders,
        corsEnabled,
      };

      if (type === `folder+`) {
        addS3Resource({
          ...s3ResourceInit,
          proxy: {folder: true, proxyName: folderProxyName},
        });
      } else {
        addS3Resource(s3ResourceInit);

        if (type === `file+`) {
          addS3Resource({
            ...s3ResourceInit,
            proxy: {folder: false, proxyName: fileFunctionProxyName},
          });
        }
      }
    }
  }
}
