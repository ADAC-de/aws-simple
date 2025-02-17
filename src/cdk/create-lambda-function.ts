import type {LambdaRoute, StackConfig} from '../read-stack-config.js';
import type {Stack} from 'aws-cdk-lib';

import {getDomainName} from '../utils/get-domain-name.js';
import {getHash} from '../utils/get-hash.js';
import {getNormalizedName} from '../utils/get-normalized-name.js';
import {Duration, aws_lambda, aws_logs} from 'aws-cdk-lib';
import {basename, dirname, extname, join} from 'path';

const maxTimeoutInSeconds = 28;

export function createLambdaFunction(
  stackConfig: StackConfig,
  route: LambdaRoute,
  stack: Stack,
): aws_lambda.FunctionBase {
  const {
    httpMethod,
    publicPath,
    path,
    functionName,
    memorySize = 128,
    timeoutInSeconds = maxTimeoutInSeconds,
    environment,
  } = route;

  if (timeoutInSeconds > maxTimeoutInSeconds) {
    throw new Error(
      `The timeout of a Lambda function must be less than the maximum API gateway integration timeout of 29 seconds.`,
    );
  }

  const domainName = getDomainName(stackConfig);

  // Example: POST-foo-bar-baz-1234567
  const uniqueFunctionName = `${httpMethod}-${getNormalizedName(
    functionName,
  )}-${getHash(functionName, domainName)}`;

  if (uniqueFunctionName.length > 64) {
    throw new Error(
      `The unique name of a Lambda function must not be longer than 64 characters: ${uniqueFunctionName}`,
    );
  }

  return new aws_lambda.Function(
    stack,
    `Function${getHash(uniqueFunctionName)}`,
    {
      functionName: uniqueFunctionName,
      code: aws_lambda.Code.fromAsset(dirname(path)),
      handler: `${basename(path, extname(path))}.handler`,
      description: `${functionName} => ${httpMethod} https://${join(
        domainName,
        publicPath,
      )}`,
      memorySize,
      environment,
      timeout: Duration.seconds(timeoutInSeconds),
      runtime: aws_lambda.Runtime.NODEJS_20_X,
      tracing: aws_lambda.Tracing.PASS_THROUGH,
      logRetention: aws_logs.RetentionDays.TWO_WEEKS,
    },
  );
}
