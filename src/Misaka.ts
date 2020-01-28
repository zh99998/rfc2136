import nodeFetch, { RequestInfo, RequestInit } from 'node-fetch';
import fetchCookie from 'fetch-cookie/node-fetch';
import FileCookieStore from 'tough-cookie-filestore';
import { CookieJar } from 'tough-cookie';
import { DNSRecord } from './typings';
import { consts } from 'native-dns';

const fetch: typeof nodeFetch = fetchCookie(nodeFetch, new CookieJar(new FileCookieStore('./cookie.json')));

const { NAME_TO_RCODE, NAME_TO_QTYPE, QTYPE_TO_NAME } = consts;

export class MisakaZone {
  id: 1241;
  name: string;
  friendly_name: 'moecube.com';
  comment: '';
  enabled: true;
  dirty: false;

  static async load(name: string) {
    try {
      return await this.doLoad(name);
    } catch (e) {
      if (e.status === 401) {
        await this.login();
        return await this.doLoad(name);
      } else {
        throw e;
      }
    }
  }
  static async loadRecordSets(name: string) {
    try {
      return await this.doLoadRecordSets(name);
    } catch (e) {
      if (e.status === 401) {
        await this.login();
        return await this.doLoadRecordSets(name);
      } else {
        throw e;
      }
    }
  }
  static async login() {
    console.log('login');
    return this.fetch('https://dns.misaka.io/session/login', {
      method: 'POST',
      body: JSON.stringify({ username: process.env.MISAKA_USERNAME, password: process.env.MISAKA_PASSWORD })
    });
  }
  static async doLoad(name: string) {
    const zone = (await this.fetchJSON('https://dns.misaka.io/zones')).results.find(z => z.name === name);
    if (zone) {
      const result = new MisakaZone();
      Object.assign(result, zone);
      return result;
    }
  }
  static async doLoadRecordSets(name: string) {
    const result = new MisakaZone();
    result.name = name;
    try {
      await result.recordsets();
    } catch (e) {
      if (e.status === 404) {
        return null;
      } else {
        throw e;
      }
    }
    return result;
  }
  static async fetchJSON(url: RequestInfo, init?: RequestInit) {
    const response = await this.fetch(url, init);
    const result = await response.json();
    console.info(result);
    return result;
  }
  static async fetch(url: RequestInfo, init?: RequestInit) {
    init = { ...init, headers: { 'content-type': 'application/json' } };
    console.info(url, init);
    const response = await fetch(url, init);
    if (response.ok) {
      return response;
    } else {
      console.error(response.status, response.statusText);
      console.error(await response.text());
      throw response;
    }
  }
  private _recordsets: MisakaRecordSet[];
  async recordsets(): Promise<MisakaRecordSet[]> {
    if (this._recordsets) {
      return this._recordsets;
    }
    return (this._recordsets = (await MisakaZone.fetchJSON(`https://dns.misaka.io/zones/${this.name}/recordsets`)).results);
  }

  deleteRecordSet(recordset: MisakaRecordSet) {
    return MisakaZone.fetch(`https://dns.misaka.io/zones/${this.name}/recordsets/${recordset.name}/${recordset.type}`, {
      method: 'DELETE'
    });
  }

  addRecordSet(rr: DNSRecord) {
    const name = rr.name;
    const type = QTYPE_TO_NAME[rr.type];
    const recordset = {
      ttl: rr.ttl,
      records: [{ value: rr.address }],
      filters: []
    };
    return MisakaZone.fetch(`https://dns.misaka.io/zones/${this.name}/recordsets/${name}/${type}`, {
      method: 'PUT',
      body: JSON.stringify(recordset)
    });
  }
  updateRecordSet(recordset: MisakaRecordSet) {
    const r = { ...recordset };
    delete r.name;
    delete r.type;
    return MisakaZone.fetch(`https://dns.misaka.io/zones/${this.name}/recordsets/${recordset.name}/${recordset.type}`, {
      method: 'POST',
      body: JSON.stringify(r)
    });
  }

  addRecord(recordset: MisakaRecordSet, record: MisakaRecord) {
    return this.updateRecords(recordset, [...recordset.records, record]);
  }
  deleteRecords(recordset: MisakaRecordSet, records: MisakaRecord[]) {
    return this.updateRecords(
      recordset,
      recordset.records.filter(r => !records.includes(r))
    );
  }
  updateRecords(recordset: MisakaRecordSet, records: MisakaRecord[]) {
    return this.updateRecordSet({ ...recordset, records });
  }
}
export interface MisakaRecordSet {
  enabled: true;
  filters: [];
  name: string;
  protected: false;
  records: MisakaRecord[];
  ttl: number;
  type: string;
}
export interface MisakaRecord {
  value: string;
}
