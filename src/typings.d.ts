export interface DNSRecord {
  name: string;
  type: number;
  class: number;
  ttl: number;
  address: string;
}
export interface DNSRequest {
  header: { id: 43544; qr: 0; opcode: 5; aa: 0; tc: 0; rd: 0; ra: 0; res1: 0; res2: 0; res3: 0; rcode: 0 };
  question: [{ name: string; type: 6; class: 1 }];
  answer: DNSRecord[];
  authority: DNSRecord[];
  additional: [];
  edns_options: [];
  payload: undefined;
  address: { address: '127.0.0.1'; family: 'IPv4'; port: 32770; size: 55 };
}

export const enum NAME_TO_OPCODE {
  Query = 0,
  Status = 2,
  Notify = 4,
  Update = 5,
  DSO = 6
}
export const enum NAME_TO_CLASS {
  IN = 1,
  Chaos = 3,
  Hesiod = 4,
  NONE = 254,
  ANY = 255
}
