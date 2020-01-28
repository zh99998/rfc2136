import fs from "fs";
import dgram from "dgram";
import packet from "native-dns-packet";
import wildcard from "wildcard2";
// import util from "./util.js";

const defaults = {
  port: 53,
  host: "127.0.0.1",
  logging: "dnsproxy:query,dnsproxy:info",
  nameservers: ["1.1.1.1", "1.0.0.1"],
  servers: {},
  domains: {
    xdev: "127.0.0.1"
  },
  hosts: {
    devlocal: "127.0.0.1"
  },
  fallback_timeout: 350,
  reload_config: true
};

const server = dgram.createSocket("udp4");

server.on("error", function(err) {
  console.error("udp socket error");
  console.error(err);
});

server.on("message", function(message, rinfo) {
  // console

  const query = packet.parse(message);
  const domain = query.question[0].name;
  const type = query.question[0].type;

  let nameserver = "173.245.59.125";
  console.debug("query: %j", query);
  if (query.opcode == 0) {

  }

  let nameParts = nameserver.split(":");
  nameserver = nameParts[0];
  let port = parseInt(nameParts[1]) || 53;
  let fallback;
  (function queryns(message, nameserver) {
    const sock = dgram.createSocket("udp4");
    sock.send(message, 0, message.length, port, nameserver, function() {
      fallback = setTimeout(function() {
        queryns(message, nameserver);
      }, 500);
    });
    sock.on("error", function(err) {
      console.error("Socket Error: %s", err);
      process.exit(5);
    });
    sock.on("message", function(response) {
      console.log(response)
      clearTimeout(fallback);
      server.send(response, 0, response.length, rinfo.port, rinfo.address);
      sock.close();
    });
  })(message, nameserver);
});

server.bind(53, "0.0.0.0");
