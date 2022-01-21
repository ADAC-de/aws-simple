import type {
  APIGatewayProxyEventMultiValueQueryStringParameters,
  APIGatewayProxyEventQueryStringParameters,
} from 'aws-lambda';
import type {Request} from 'express';
import type {ParamsDictionary} from 'express-serve-static-core';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((element) => typeof element === `string`);

export const getQueryStringParameters = (
  query: Request<ParamsDictionary>['query'],
): {
  multiValueQueryStringParameters: APIGatewayProxyEventMultiValueQueryStringParameters;
  queryStringParameters: APIGatewayProxyEventQueryStringParameters;
} => {
  const queryStringParameters: APIGatewayProxyEventQueryStringParameters = {};
  const multiValueQueryStringParameters: APIGatewayProxyEventMultiValueQueryStringParameters =
    {};

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === `string`) {
      multiValueQueryStringParameters[key] = [value];
      queryStringParameters[key] = value;
    }

    if (isStringArray(value)) {
      multiValueQueryStringParameters[key] = value;
    }
  }

  return {multiValueQueryStringParameters, queryStringParameters};
};
