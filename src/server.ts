import dns, { consts } from 'native-dns';
import { DNSRecord, DNSRequest, NAME_TO_CLASS, NAME_TO_OPCODE } from './typings';
import { MisakaRecordSet, MisakaZone } from './Misaka';
import MultiKeyMap from 'multikeymap';
import util from 'util';

const server = dns.createServer();

const pending = new Set();

const { NAME_TO_RCODE, RCODE_TO_NAME, NAME_TO_QTYPE, QTYPE_TO_NAME } = consts;

server.on('request', async (request: DNSRequest, response) => {
  if (request.header.opcode === NAME_TO_OPCODE.Update) {
    if (pending.has(request.header.id)) {
      return;
    }
    pending.add(request.header.id);
    const requestInfo = { ...request };
    // @ts-ignore
    delete requestInfo._socket;
    console.log(requestInfo);
    try {
      response.header.rcode = await processRequest(request);
    } catch (e) {
      console.error(e);
      response.header.rcode = NAME_TO_RCODE.SERVFAIL;
    }
    console.info(RCODE_TO_NAME[response.header.rcode]);
    pending.delete(request.header.id);
  } else {
    try {
      console.info(request);
      const innerResponse = await forward(request);
      response.header.rcode = innerResponse.header.rcode;
      response.answer = innerResponse.answer;
      response.additional = innerResponse.additional;
      response.authority = innerResponse.authority;
      console.info(response);
    } catch (e) {
      console.error(e);
      response.header.rcode = NAME_TO_RCODE.SERVFAIL;
    }
  }

  response.send();
});
async function forward(question: DNSRequest) {
  return new Promise<DNSRequest>(async (resolve, reject) => {
    const [address] = await util.promisify(dns.resolve4)('a.m1ns.com');
    const request = dns.Request({
      question: question.question[0],
      server: { address, port: 53, type: 'udp' },
      cache: false,
      timeout: 5000
    });
    request.on('timeout', () => reject(new Error('Timeout in making request')));
    request.on('message', (err, answer) => (err ? reject(err) : resolve(answer)));
    request.send();
  });
}

async function processRequest(request: DNSRequest): Promise<number> {
  // 3.1.1. The Zone Section is checked to see that there is exactly one
  // RR therein and that the RR's ZTYPE is SOA, else signal FORMERR to the
  // requestor.  Next, the ZNAME and ZCLASS are checked to see if the zone
  // so named is one of this server's authority zones, else signal NOTAUTH
  // to the requestor.  If the server is a zone slave, the request will be
  // forwarded toward the primary master.
  //
  // 3.1.2 - Pseudocode For Zone Section Processing
  //
  // if (zcount != 1 || ztype != SOA)
  //   return (FORMERR)
  // if (zone_type(zname, zclass) === SLAVE)
  //   return forward()
  // if (zone_type(zname, zclass) === MASTER)
  //   return update()
  // return (NOTAUTH)
  if (!(request.question.length === 1 && request.question[0].type === NAME_TO_QTYPE.SOA)) {
    console.info('Error', 1);
    return NAME_TO_RCODE.FORMERR;
  }
  const zname = request.question[0].name;
  const zone = await MisakaZone.loadRecordSets(zname);
  if (!zone) {
    console.info('Error', 2);
    return NAME_TO_RCODE.NOTAUTH;
  }

  const zone_rrset = await zone.recordsets();
  const zclass = NAME_TO_CLASS.IN;
  //    3.2.4 - Table Of Metavalues Used In Prerequisite Section
  //
  //    CLASS    TYPE     RDATA    Meaning
  //    ------------------------------------------------------------
  //    ANY      ANY      empty    Name is in use
  //    ANY      rrset    empty    RRset exists (value independent)
  //    NONE     ANY      empty    Name is not in use
  //    NONE     rrset    empty    RRset does not exist
  //    zone     rrset    rr       RRset exists (value dependent)

  //   3.2.5 - Pseudocode for Prerequisite Section Processing
  //
  //       for rr in prerequisites
  //            if (rr.ttl != 0)
  //                 return (FORMERR)
  //            if (zone_of(rr.name) != ZNAME)
  //                 return (NOTZONE);
  //            if (rr.class == ANY)
  //                 if (rr.rdlength != 0)
  //                      return (FORMERR)
  //                 if (rr.type == ANY)
  //                      if (!zone_name<rr.name>)
  //                           return (NXDOMAIN)
  //                 else
  //                      if (!zone_rrset<rr.name, rr.type>)
  //                           return (NXRRSET)
  //            if (rr.class == NONE)
  //                 if (rr.rdlength != 0)
  //                      return (FORMERR)
  //                 if (rr.type == ANY)
  //                      if (zone_name<rr.name>)
  //                           return (YXDOMAIN)
  //                 else
  //                      if (zone_rrset<rr.name, rr.type>)
  //                           return (YXRRSET)
  //            if (rr.class == zclass)
  //                 temp<rr.name, rr.type> += rr
  //            else
  //                 return (FORMERR)
  //
  //       for rrset in temp
  //            if (zone_rrset<rrset.name, rrset.type> != rrset)
  //                 return (NXRRSET)

  const temp: Map<[string, number], DNSRecord[]> = new MultiKeyMap();
  for (let rr of request.answer) {
    if (rr.ttl !== 0) {
      console.info('Error', 3);
      return NAME_TO_RCODE.FORMERR;
    }
    if (!rr.name.endsWith(zname)) {
      console.info('Error', 4);
      return NAME_TO_RCODE.NOTZONE;
    }
    rr = { ...rr, name: rr.name.slice(0, rr.name.length - zone.name.length - 1) };

    if (rr.class == NAME_TO_CLASS.ANY) {
      if (rr.address) {
        console.info('Error', 5);
        return NAME_TO_RCODE.FORMERR;
      }
      if (rr.type == NAME_TO_QTYPE.ANY) {
        if (!zone_rrset.some(r => r.name === rr.name)) {
          console.info('Error', 6);
          return NAME_TO_RCODE.NXDOMAIN;
        }
      } else {
        if (!zone_rrset.some(r => r.name === rr.name && NAME_TO_QTYPE[r.type] === rr.type)) {
          console.info('Error', 7);
          return NAME_TO_RCODE.NXRRSET;
        }
      }
    }

    if (rr.class == NAME_TO_CLASS.NONE) {
      if (rr.address) {
        console.info('Error', 8);
        return NAME_TO_RCODE.FORMERR;
      }
      if (rr.type == NAME_TO_QTYPE.ANY) {
        if (zone_rrset.some(r => r.name === rr.name)) {
          console.info('Error', 9);
          return NAME_TO_RCODE.YXDOMAIN;
        }
      } else {
        if (zone_rrset.some(r => r.name === rr.name && NAME_TO_QTYPE[r.type] === rr.type)) {
          console.info('Error', 10);
          return NAME_TO_RCODE.YXRRSET;
        }
      }
    } else if (rr.class == zclass) {
      let rrset = temp.get([rr.name, rr.type]);
      if (!rrset) {
        rrset = [];
        temp.set([rr.name, rr.type], rrset);
      }
      rrset.push(rr);
    } else {
      console.info('Error', 11);
      return NAME_TO_RCODE.FORMERR;
    }

    for (const [[name, type], rrset] of temp) {
      if (!rrset_equal(rrset, zone_rrset.find(r => r.name === name && NAME_TO_QTYPE[r.type] === type))) {
        console.info('Error', 12);
        return NAME_TO_RCODE.NXRRSET;
      }
    }
  }

  //   3.4.1.3 - Pseudocode For Update Section Prescan
  //
  //       [rr] for rr in updates
  //            if (zone_of(rr.name) != ZNAME)
  //                 return (NOTZONE);
  //            if (rr.class == zclass)
  //                 if (rr.type & ANY|AXFR|MAILA|MAILB)
  //                      return (FORMERR)
  //            elsif (rr.class == ANY)
  //                 if (rr.ttl != 0 || rr.rdlength != 0
  //                     || rr.type & AXFR|MAILA|MAILB)
  //                      return (FORMERR)
  //            elsif (rr.class == NONE)
  //                 if (rr.ttl != 0 || rr.type & ANY|AXFR|MAILA|MAILB)
  //                      return (FORMERR)
  //            else
  //                 return (FORMERR)
  for (const rr of request.authority) {
    if (!rr.name.endsWith(zname)) {
      console.info('Error', 13);
      return NAME_TO_RCODE.NOTZONE;
    }
    if (rr.class == zclass) {
      if ([NAME_TO_QTYPE.ANY, NAME_TO_QTYPE.AXFR, NAME_TO_QTYPE.MAILA, NAME_TO_QTYPE.MAILB].includes(rr.type)) {
        console.info('Error', 14);
        return NAME_TO_RCODE.FORMERR;
      }
    } else if (rr.class == NAME_TO_CLASS.ANY) {
      if (rr.ttl != 0 || rr.address || [NAME_TO_QTYPE.AXFR, NAME_TO_QTYPE.MAILA, NAME_TO_QTYPE.MAILB].includes(rr.type))
        console.info('Error', 15);
      return NAME_TO_RCODE.FORMERR;
    } else if (rr.class == NAME_TO_CLASS.NONE) {
      if (rr.ttl != 0 || [NAME_TO_QTYPE.ANY, NAME_TO_QTYPE.AXFR, NAME_TO_QTYPE.MAILA, NAME_TO_QTYPE.MAILB].includes(rr.type))
        console.info('Error', 16);
      return NAME_TO_RCODE.FORMERR;
    } else {
      console.info('Error', 17);
      return NAME_TO_RCODE.FORMERR;
    }
  }

  //    3.4.2 - Update
  //
  //    The Update Section is parsed into RRs and these RRs are processed in
  //    order.
  //
  //    3.4.2.1. If any system failure (such as an out of memory condition,
  //    or a hardware error in persistent storage) occurs during the
  //    processing of this section, signal SERVFAIL to the requestor and undo
  //    all updates applied to the zone during this transaction.
  //
  //    3.4.2.2. Any Update RR whose CLASS is the same as ZCLASS is added to
  //    the zone.  In case of duplicate RDATAs (which for SOA RRs is always
  //    the case, and for WKS RRs is the case if the ADDRESS and PROTOCOL
  //    fields both match), the Zone RR is replaced by Update RR.  If the
  //    TYPE is SOA and there is no Zone SOA RR, or the new SOA.SERIAL is
  //    lower (according to [RFC1982]) than or equal to the current Zone SOA
  //    RR's SOA.SERIAL, the Update RR is ignored.  In the case of a CNAME
  //    Update RR and a non-CNAME Zone RRset or vice versa, ignore the CNAME
  //    Update RR, otherwise replace the CNAME Zone RR with the CNAME Update
  //    RR.
  //
  //    3.4.2.3. For any Update RR whose CLASS is ANY and whose TYPE is ANY,
  //    all Zone RRs with the same NAME are deleted, unless the NAME is the
  //    same as ZNAME in which case only those RRs whose TYPE is other than
  //    SOA or NS are deleted.  For any Update RR whose CLASS is ANY and
  //    whose TYPE is not ANY all Zone RRs with the same NAME and TYPE are
  //    deleted, unless the NAME is the same as ZNAME in which case neither
  //    SOA or NS RRs will be deleted.
  //    3.4.2.4. For any Update RR whose class is NONE, any Zone RR whose
  //    NAME, TYPE, RDATA and RDLENGTH are equal to the Update RR is deleted,
  //    unless the NAME is the same as ZNAME and either the TYPE is SOA or
  //    the TYPE is NS and the matching Zone RR is the only NS remaining in
  //    the RRset, in which case this Update RR is ignored.
  //
  //    3.4.2.5. Signal NOERROR to the requestor.
  //
  //    3.4.2.6 - Table Of Metavalues Used In Update Section
  //
  //    CLASS    TYPE     RDATA    Meaning
  //    ---------------------------------------------------------
  //    ANY      ANY      empty    Delete all RRsets from a name
  //    ANY      rrset    empty    Delete an RRset
  //    NONE     rrset    rr       Delete an RR from an RRset
  //    zone     rrset    rr       Add to an RRset
  //
  //    3.4.2.7 - Pseudocode For Update Section Processing
  //      [rr] for rr in updates
  //            if (rr.class === zclass)
  //                 if (rr.type === CNAME)
  //                      if (zone_rrset<rr.name, ~CNAME>)
  //                           next [rr]
  //                 elsif (zone_rrset<rr.name, CNAME>)
  //                      next [rr]
  //                 if (rr.type === SOA)
  //                      if (!zone_rrset<rr.name, SOA> ||
  //                          zone_rr<rr.name, SOA>.serial > rr.soa.serial)
  //                           next [rr]
  //                 for zrr in zone_rrset<rr.name, rr.type>
  //                      if (rr.type === CNAME || rr.type === SOA ||
  //                          (rr.type === WKS && rr.proto === zrr.proto &&
  //                           rr.address === zrr.address) ||
  //                          rr.rdata === zrr.rdata)
  //                           zrr = rr
  //                           next [rr]
  //                 zone_rrset<rr.name, rr.type> += rr
  //            elsif (rr.class === ANY)
  //                 if (rr.type === ANY)
  //                      if (rr.name === zname)
  //                           zone_rrset<rr.name, ~(SOA|NS)> = Nil
  //                      else
  //                           zone_rrset<rr.name, *> = Nil
  //                 elsif (rr.name === zname &&
  //                        (rr.type === SOA || rr.type === NS))
  //                      next [rr]
  //                 else
  //                     zone_rrset<rr.name, rr.type> = Nil
  //            elsif (rr.class === NONE)
  //                 if (rr.type === SOA)
  //                      next [rr]
  //                 if (rr.type === NS && zone_rrset<rr.name, NS> === rr)
  //                      next [rr]
  //                 zone_rr<rr.name, rr.type, rr.data> = Nil
  //       return (NOERROR)

  for (const rr of request.authority) {
    await processRR(rr, zname, zclass, zone, zone_rrset);
  }
  return NAME_TO_RCODE.NOERROR;
}

function rrset_equal(rrset: DNSRecord[], _rrset: MisakaRecordSet): boolean {
  if (!_rrset) {
    return false;
  }
  if (rrset.length !== _rrset.records.length) {
    return false;
  }
  if (rrset.some(rr => rr.ttl !== _rrset.ttl)) {
    return false;
  }
  const a = rrset.map(r => r.address).sort();
  const b = _rrset.records.map(r => r.value).sort();
  return a.every((rr, index) => rr === b[index]);
}

async function processRR(rr: DNSRecord, zname: string, zclass: number, zone: MisakaZone, zone_rrset: MisakaRecordSet[]) {
  rr = { ...rr, name: rr.name.slice(0, rr.name.length - zone.name.length - 1) };
  if (rr.class === zclass) {
    if (rr.type === NAME_TO_QTYPE.CNAME) {
      if (zone_rrset.some(r => r.name === rr.name && r.type !== 'CNAME')) {
        return;
      }
    } else if (zone_rrset.some(r => r.name === rr.name && r.type === 'CNAME')) {
      return;
    }
    if (rr.type === NAME_TO_QTYPE.SOA) {
      // TODO: SOA相关实现
      //  if (!zone_rrset<rr.name, SOA> ||
      //      zone_rr<rr.name, SOA>.serial > rr.soa.serial)
      //       next [rr]
      return;
    }
    const recordset = zone_rrset.find(r => r.name === rr.name && NAME_TO_QTYPE[r.type] === rr.type);
    if (recordset) {
      for (const zrr of recordset.records) {
        if (
          rr.type === NAME_TO_QTYPE.CNAME ||
          rr.type === NAME_TO_QTYPE.SOA ||
          // TODO: WKS 相关实现
          // (rr.type === NAME_TO_QTYPE.WKS && rr.proto === zrr.proto && rr.address === zrr.address) ||
          rr.address === zrr.value
        ) {
          if (rr.address !== zrr.value) {
            await zone.updateRecords(recordset, [{ value: rr.address }]);
          }
          return;
        }
      }
      await zone.addRecord(recordset, { value: rr.address });
    } else {
      await zone.addRecordSet(rr);
    }
  } else if (rr.class === NAME_TO_QTYPE.ANY) {
    if (rr.type === NAME_TO_CLASS.ANY) {
      let recordsets;
      if (rr.name === zname) {
        recordsets = zone_rrset.filter(r => !['SOA', 'NS'].includes(r.type));
      } else {
        recordsets = zone_rrset.filter(r => r.name === rr.name);
      }
      for (const recordset of recordsets) {
        await zone.deleteRecordSet(recordset);
      }
    } else if (rr.name === zname && (rr.type === NAME_TO_QTYPE.SOA || NAME_TO_QTYPE.NS)) {
      return;
    } else {
      const recordset = zone_rrset.find(r => r.name === rr.name && NAME_TO_QTYPE[r.type] === rr.type);
      await zone.deleteRecordSet(recordset);
    }
  } else if (rr.class === NAME_TO_CLASS.NONE) {
    if (rr.type === NAME_TO_QTYPE.SOA) {
      return;
    }
    // TODO: NS 相关实现
    // if (rr.type === NAME_TO_QTYPE.NS && zone_rrset<rr.name, NS> === rr)
    //      next [rr]
    const recordset = zone_rrset.find(r => r.name === rr.name && NAME_TO_QTYPE[r.type] === rr.type);
    const zone_rr = recordset.records.filter(r => r.value === rr.address);
    await zone.deleteRecords(recordset, zone_rr);
  }
}

server.on('error', function(err, buff, req, res) {
  console.log(err.stack);
});

(async function() {
  // await login();
  server.serve(53);
})();

process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});
