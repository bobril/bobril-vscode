import * as http from "http";

export function postRequest<T>(url: string, data: object): Promise<T> {
  const dataStr = JSON.stringify(data);
  const options = {
    hostname: "localhost",
    port: 8080,
    path: url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": dataStr.length
    }
  };
  return new Promise<T>((resolve, reject) => {
    const req = http.request(options, res => {
      if (res.statusCode! >= 300) {
        reject(
          new Error("Response from " + url + " was http " + res.statusCode)
        );
        return;
      }
      var respData: string[] = [];
      res.on("data", d => {
        respData.push(d);
      });
      res.on("end", () => {
        resolve(JSON.parse(respData.join("")));
      });
    });

    req.on("error", error => {
      reject(error);
    });

    req.write(dataStr);
    req.end();
  });
}

export function leadingWhiteSpaceCount(str: string): number {
  for (var i = 0; i < str.length; i++) {
    if (str[i] != " ") return i;
  }
  return i;
}

export function trailingWhiteSpaceCount(str: string): number {
  var res = 0;
  for (var i = str.length; i-- > 0; ) {
    if (str[i] != " ") return res;
    res++;
  }
  return res;
}
