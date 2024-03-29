import * as url from "url";
import * as http from "http";

export class Connection {
  private url: string;
  private id: string;
  private toSend: any[];
  private sendTimer?: NodeJS.Timer;
  private closed: boolean;
  private longPolling?: http.ClientRequest;
  private heartBeatTimer?: NodeJS.Timeout;

  onMessage?: (connection: Connection, message: string, data: any) => void;
  onClose?: (connection: Connection) => void;

  constructor(url: string) {
    this.onMessage = undefined;
    this.onClose = undefined;
    this.url = url;
    this.toSend = [];
    this.id = "";
    this.sendTimer = undefined;
    this.closed = false;
    this.longPolling = undefined;
    this.heartBeatTimer = undefined;
  }

  connect() {
    this.toSend = [];
    this.id = "";
    this.sendTimer = undefined;
    this.closed = false;
    this.longPolling = undefined;
    this.heartBeatTimer = undefined;
    this.reSendTimer();
  }

  send(message: string, data: any) {
    this.toSend.push({ m: message, d: data });
    this.reSendTimer();
  }

  close() {
    if (this.closed) {
      return;
    }
    if (this.longPolling) {
      this.longPolling.abort();
      this.longPolling = undefined;
    }
    this.closed = true;
    this.toSend = [];
    if (this.onClose !== undefined) {
      this.onClose(this);
    }
    this.reSendTimer();
  }

  private reSendTimer() {
    if (this.sendTimer === undefined && (!this.closed || this.id !== "")) {
      this.sendTimer = setTimeout(() => {
        this.doSend();
      }, 10);
    }
  }

  private parseResponse(resp: string): boolean {
    var data;
    try {
      data = JSON.parse(resp);
    } catch (err) {
      return false;
    }
    if (typeof data.id !== "string") {
      return false;
    }
    this.id = data.id;
    if (data.close) {
      return false;
    }
    let m = data.m;
    if (Array.isArray(m)) {
      for (let i = 0; i < m.length; i++) {
        this.onMessage!(this, m[i].m, m[i].d);
      }
    }
    return true;
  }

  private doSend() {
    this.sendTimer = undefined;
    if (this.closed && this.id === "") {
      return;
    }
    let cliReqOpt = <any>url.parse(this.url);
    cliReqOpt.method = "POST";
    cliReqOpt.headers = {
      Connection: "keep-alive"
    };
    var req = http.request(cliReqOpt, res => {
      //console.log(`STATUS: ${res.statusCode}`);
      //console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
      if (res.statusCode! < 200 || res.statusCode! >= 300) {
        this.close();
        req.abort();
        return;
      }
      res.setEncoding("utf8");
      let resp = "";
      res.on("data", chunk => {
        //console.log(`BODY: ${chunk}`);
        resp += chunk;
      });
      res.on("end", () => {
        if (!this.parseResponse(resp)) {
          this.id = "";
          this.close();
          return;
        }
        if (!this.longPolling) {
          this.startLongPolling();
        }
        this.startHeartBeat();
      });
    });
    req.on("error", e => {
      this.close();
    });
    req.write(
      JSON.stringify(
        this.closed
          ? { id: this.id, close: true }
          : { id: this.id, m: this.toSend }
      )
    );
    req.end();
    if (this.closed) {
      this.id = "";
    }
    this.toSend = [];
  }

  private startLongPolling() {
    if (this.closed || this.id === "") {
      return;
    }
    let cliReqOpt = <any>url.parse(this.url);
    cliReqOpt.method = "POST";
    cliReqOpt.headers = {
      Connection: "keep-alive"
    };
    var req = http.request(cliReqOpt, res => {
      //console.log(`LSTATUS: ${res.statusCode}`);
      //console.log(`LHEADERS: ${JSON.stringify(res.headers)}`);
      if (res.statusCode! < 200 || res.statusCode! >= 300) {
        this.longPolling = undefined;
        this.startLongPolling();
        return;
      }
      res.setEncoding("utf8");
      let resp = "";
      res.on("data", chunk => {
        //console.log(`LBODY: ${chunk}`);
        resp += chunk;
      });
      res.on("end", () => {
        this.longPolling = undefined;
        if (!this.parseResponse(resp)) {
          this.id = "";
          this.close();
          return;
        }
        this.startLongPolling();
        this.startHeartBeat();
      });
    });
    req.on("error", e => {
      this.longPolling = undefined;
      this.close();
    });
    req.end(JSON.stringify({ id: this.id }));
    this.longPolling = req;
  }

  private startHeartBeat() {
    if (this.heartBeatTimer !== undefined) {
      clearTimeout(this.heartBeatTimer);
    }
    this.heartBeatTimer = setTimeout(() => {
      this.heartBeatTimer = undefined;
      this.doSend();
    }, 30000);
  }
}
