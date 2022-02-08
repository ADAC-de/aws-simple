import path from 'path';
import type {Stack, aws_apigateway, aws_lambda} from 'aws-cdk-lib';

export interface StackConfig {
  readonly hostedZoneName: string;
  readonly aliasRecordName?: string;
  readonly cachingEnabled?: boolean;

  readonly authentication?: {
    readonly username: string;
    readonly password: string;
    readonly realm?: string;
    /** Default: `300` seconds (if caching is enabled) */
    readonly cacheTtlInSeconds?: number;
  };

  readonly monitoring?: {
    readonly accessLoggingEnabled?: boolean;
    readonly loggingEnabled?: boolean;
    readonly metricsEnabled?: boolean;
    readonly tracingEnabled?: boolean;
  };

  readonly throttling?: {
    /** Default: `10000` requests per second */
    readonly rateLimit: number;
    /** Default: `5000` requests */
    readonly burstLimit: number;
  };

  readonly routes: readonly [Route, ...Route[]];

  readonly onSynthesize?: (constructs: {
    readonly stack: Stack;
    readonly restApi: aws_apigateway.RestApiBase;
  }) => void;
}

export type Route = LambdaRoute | S3Route;

export interface LambdaRoute extends RouteOptions {
  readonly type: 'function';
  readonly httpMethod: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT';
  readonly publicPath: string;
  readonly path: string;
  readonly functionName: string;
  /** Default: `128` MB */
  readonly memorySize?: number;
  /** Default: `28` seconds (this is the maximum timeout) */
  readonly timeoutInSeconds?: number;
  readonly environment?: Readonly<Record<string, string>>;
  readonly requestParameters?: Readonly<Record<string, LambdaRequestParameter>>;

  readonly onSynthesize?: (constructs: {
    readonly stack: Stack;
    readonly restApi: aws_apigateway.RestApiBase;
    readonly lambdaFunction: aws_lambda.FunctionBase;
  }) => void;
}

export interface LambdaRequestParameter {
  readonly cacheKey?: boolean;
  readonly required?: boolean;
}

export interface S3Route extends RouteOptions {
  readonly type: 'file' | 'folder';
  readonly httpMethod?: 'GET';
  readonly publicPath: string;
  readonly path: string;
  readonly responseHeaders?: Readonly<Record<string, string>>;
}

export interface RouteOptions {
  /** Default: `300` seconds (if caching is enabled) */
  readonly cacheTtlInSeconds?: number;
  readonly authenticationEnabled?: boolean;
  readonly corsEnabled?: boolean;
}

export function getStackConfig(port?: number): StackConfig {
  let defaultExport;

  try {
    defaultExport = require(path.resolve(`aws-simple.config.js`)).default;
  } catch (error) {
    throw new Error(`The config file cannot be found.`);
  }

  if (typeof defaultExport !== `function`) {
    throw new Error(`The config file does not have a valid default export.`);
  }

  return defaultExport(port);
}
