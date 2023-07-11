import { Request } from "express";
import core from "express-serve-static-core";
import { IncomingHttpHeaders } from "node:http";

export const CLIENT_ID_HEADER = "x-braekhus-client-id";

export type IncomingRequest = Request<
  core.ParamsDictionary,
  any,
  any,
  core.Query,
  Record<string, any>
>;

export type ForwardedRequest = {
  headers: IncomingHttpHeaders;
  method: string;
  path: string;
  params: qs.ParsedQs;
  data: any;
};

export type ForwardedResponse = {
  headers: Record<string, any>;
  status: number;
  statusText: string;
  data: any;
};

export type PublicKeyGetter = (clientId: string) => Promise<any | undefined>;
