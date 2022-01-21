import type {APIGatewayProxyEvent} from 'aws-lambda';
import type express from 'express';

export function getRequestHeaders(
  req: express.Request,
): Pick<APIGatewayProxyEvent, 'headers' | 'multiValueHeaders'> {
  const headers: Record<string, string> = {};
  const multiValueHeaders: Record<string, string[]> = {};

  Object.entries(req.headers).forEach(([key, value]) => {
    if (value) {
      const multiValue = [value].flat();
      multiValueHeaders[key] = multiValue;
      headers[key] = multiValue[multiValue.length - 1] || ``;
    }
  });

  return {headers, multiValueHeaders};
}
