import { Request } from "express";
import core from "express-serve-static-core";
import { IncomingHttpHeaders } from "node:http";

export const JQ_HEADER = "braekhus-jq-response-filter";

export type IncomingRequest = Request<
  core.ParamsDictionary,
  any,
  any,
  core.Query,
  Record<string, any>
>;

export type ForwardedRequestOptions = {
  timeoutMillis?: number;
};

export type CallOptions = {
  timeoutMillis?: number;
};

export type ForwardedRequest = {
  headers: IncomingHttpHeaders;
  method: string;
  path: string;
  params: qs.ParsedQs;
  data: any;
  options?: ForwardedRequestOptions;
};

export type ForwardedResponse = {
  headers: Record<string, any>;
  status: number;
  statusText: string;
  data: any;
};

export type PublicKeyGetter = (clientId: string) => Promise<any | undefined>;
