export const httpError = (code: number, reason: string, body: string) =>
  `HTTP/1.1 ${code} ${reason}\r\nContent-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n${body}`;
