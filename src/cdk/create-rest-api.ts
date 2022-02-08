import {join} from 'path';
import type {Stack} from 'aws-cdk-lib';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  aws_apigateway,
  aws_certificatemanager,
  aws_logs,
  aws_route53,
  aws_route53_targets,
} from 'aws-cdk-lib';
import type {StackConfig} from '../get-stack-config';
import {getDomainName} from '../utils/get-absolute-domain-name';
import {getHash} from '../utils/get-hash';
import {getNormalizedName} from '../utils/get-normalized-name';

export function createRestApi(
  stackConfig: StackConfig,
  stack: Stack,
): aws_apigateway.RestApiBase {
  const hostedZone = aws_route53.HostedZone.fromLookup(
    stack,
    `HostedZoneLookup`,
    {domainName: stackConfig.hostedZoneName},
  );

  new CfnOutput(stack, `HostedZoneNameOutput`, {
    value: stackConfig.hostedZoneName,
  });

  const domainName = getDomainName(stackConfig);

  const certificate = new aws_certificatemanager.DnsValidatedCertificate(
    stack,
    `DnsValidatedCertificate`,
    {domainName, hostedZone},
  );

  const restApi = new aws_apigateway.RestApi(stack, `RestApi`, {
    description: domainName,
    endpointTypes: [aws_apigateway.EndpointType.REGIONAL],
    restApiName: `${getNormalizedName(domainName)}-${getHash(domainName)}`,
    domainName: {
      endpointType: aws_apigateway.EndpointType.REGIONAL,
      domainName,
      certificate,
      securityPolicy: aws_apigateway.SecurityPolicy.TLS_1_2,
    },
    disableExecuteApiEndpoint: true,
    binaryMediaTypes: [`*/*`],
    minimumCompressionSize: 150,
    deployOptions: getStageOptions(stackConfig, stack),
  });

  const recordTarget = aws_route53.RecordTarget.fromAlias(
    new aws_route53_targets.ApiGateway(restApi),
  );

  new aws_route53.ARecord(stack, `ARecord`, {
    zone: hostedZone,
    recordName: stackConfig.aliasRecordName,
    target: recordTarget,
  }).node.addDependency(restApi);

  new aws_route53.AaaaRecord(stack, `AaaaRecord`, {
    zone: hostedZone,
    recordName: stackConfig.aliasRecordName,
    target: recordTarget,
  }).node.addDependency(restApi);

  setUnauthorizedGatewayResponse(stackConfig, stack, restApi);

  new CfnOutput(stack, `RestApiIdOutput`, {
    value: restApi.restApiId,
  }).node.addDependency(restApi);

  return restApi;
}

function getStageOptions(
  stackConfig: StackConfig,
  stack: Stack,
): aws_apigateway.StageOptions {
  const {cachingEnabled, monitoring, throttling, routes} = stackConfig;

  const loggingLevel: aws_apigateway.MethodLoggingLevel =
    monitoring?.loggingEnabled
      ? aws_apigateway.MethodLoggingLevel.INFO
      : aws_apigateway.MethodLoggingLevel.OFF;

  const methodOptions = routes.reduce((options, route) => {
    const {httpMethod = `GET`, publicPath, cacheTtlInSeconds = 300} = route;

    const methodPath =
      publicPath === `/`
        ? `//${httpMethod}`
        : join(publicPath.replace(`/*`, `/{proxy+}`), httpMethod);

    return {
      ...options,
      [methodPath]: {
        cachingEnabled: cachingEnabled && cacheTtlInSeconds > 0,
        cacheTtl: Duration.seconds(cacheTtlInSeconds),
        loggingLevel,
        metricsEnabled: monitoring?.metricsEnabled,
        throttlingBurstLimit: throttling?.burstLimit,
        throttlingRateLimit: throttling?.rateLimit,
      },
    };
  }, {} as Record<string, aws_apigateway.MethodDeploymentOptions>);

  const domainName = getDomainName(stackConfig);

  const accessLogDestination = monitoring?.accessLoggingEnabled
    ? new aws_apigateway.LogGroupLogDestination(
        new aws_logs.LogGroup(stack, `AccessLogGroup`, {
          logGroupName: `/aws/apigateway/accessLogs/${domainName}}`,
          retention: aws_logs.RetentionDays.TWO_WEEKS,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      )
    : undefined;

  return {
    cacheClusterEnabled: cachingEnabled,
    methodOptions,
    accessLogDestination,
    loggingLevel,
    metricsEnabled: monitoring?.metricsEnabled,
    tracingEnabled: monitoring?.tracingEnabled,
  };
}

function setUnauthorizedGatewayResponse(
  stackConfig: StackConfig,
  stack: Stack,
  restApi: aws_apigateway.RestApiBase,
): void {
  const {authentication} = stackConfig;

  if (!authentication) {
    return;
  }

  const corsEnabled = stackConfig.routes.some((route) => route.corsEnabled);

  const corsResponseHeaders: Record<string, string> = corsEnabled
    ? {
        'gatewayresponse.header.Access-Control-Allow-Origin': `method.request.header.origin`,
        'gatewayresponse.header.Access-Control-Allow-Credentials': `'true'`,
        'gatewayresponse.header.Access-Control-Allow-Headers': `'Authorization,*'`,
      }
    : {};

  const {realm} = authentication;

  new aws_apigateway.GatewayResponse(stack, `UnauthorizedGatewayResponse`, {
    restApi,
    type: aws_apigateway.ResponseType.UNAUTHORIZED,
    responseHeaders: {
      ...corsResponseHeaders,
      'gatewayresponse.header.WWW-Authenticate': realm
        ? `'Basic realm=${realm}'`
        : `'Basic'`,
    },
    templates: {
      'application/json': `{"message":$context.error.messageString}`,
      'text/html': `$context.error.message`,
    },
  });
}
