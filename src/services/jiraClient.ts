import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

interface JiraAttachment {
  filename: string;
  content: string;
  size: number;
}

export class JiraClient {
  private baseUrl: string;
  private email: string;
  private token: string;

  constructor() {
    const config = vscode.workspace.getConfiguration("perfAgents.jira");
    this.baseUrl = (config.get<string>("url") || "").replace(/\/+$/, "");
    this.email = config.get<string>("email") || "";
    this.token = config.get<string>("apiToken") || "";
  }

  get isConfigured(): boolean {
    return !!(this.baseUrl && this.email && this.token);
  }

  private get authHeader(): string {
    return (
      "Basic " +
      Buffer.from(`${this.email}:${this.token}`).toString("base64")
    );
  }

  private async request(endpoint: string): Promise<any> {
    const url = `${this.baseUrl}/rest/api/2/${endpoint}`;
    return new Promise((resolve, reject) => {
      const mod = url.startsWith("https") ? https : http;
      const req = mod.get(
        url,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: "application/json",
          },
          timeout: 30000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve(JSON.parse(data));
            } else {
              reject(
                new Error(
                  `Jira API error ${res.statusCode}: ${data.substring(0, 200)}`
                )
              );
            }
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  async getIssue(issueKey: string): Promise<any> {
    return this.request(`issue/${issueKey}?expand=names`);
  }

  async findLinkedPackage(petIssue: any): Promise<string | null> {
    const fields = petIssue.fields || {};
    const links = fields.issuelinks || [];

    for (const link of links) {
      for (const dir of ["outwardIssue", "inwardIssue"]) {
        const linked = link[dir];
        if (linked?.key) return linked.key;
      }
    }

    if (fields.parent?.key) return fields.parent.key;

    const desc = fields.description || "";
    const refs = desc.match(/\b([A-Z]{2,10}-\d+)\b/g) || [];
    const petKey = petIssue.key || "";
    for (const ref of refs) {
      if (ref !== petKey) return ref;
    }

    return null;
  }

  async findHLDAttachment(issueKey: string): Promise<JiraAttachment | null> {
    const issue = await this.getIssue(issueKey);
    const attachments: any[] = issue.fields?.attachment || [];

    if (attachments.length === 0) return null;

    const hldPatterns = [
      /hld.*\.docx$/i,
      /high.?level.?design.*\.docx$/i,
    ];

    for (const att of attachments) {
      for (const pattern of hldPatterns) {
        if (pattern.test(att.filename || "")) {
          return {
            filename: att.filename,
            content: att.content,
            size: att.size || 0,
          };
        }
      }
    }

    const docxFiles = attachments
      .filter((a: any) => (a.filename || "").endsWith(".docx"))
      .sort((a: any, b: any) => (b.size || 0) - (a.size || 0));

    if (docxFiles.length > 0) {
      return {
        filename: docxFiles[0].filename,
        content: docxFiles[0].content,
        size: docxFiles[0].size || 0,
      };
    }

    return null;
  }

  async downloadAttachment(att: JiraAttachment): Promise<string> {
    const tmpDir = path.join(os.tmpdir(), "perf-estimation");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const destPath = path.join(tmpDir, att.filename);

    return new Promise((resolve, reject) => {
      const mod = att.content.startsWith("https") ? https : http;
      const req = mod.get(
        att.content,
        {
          headers: { Authorization: this.authHeader },
          timeout: 60000,
        },
        (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const redirectMod = res.headers.location.startsWith("https")
              ? https
              : http;
            redirectMod.get(res.headers.location, (res2) => {
              const ws = fs.createWriteStream(destPath);
              res2.pipe(ws);
              ws.on("finish", () => resolve(destPath));
              ws.on("error", reject);
            });
            return;
          }
          const ws = fs.createWriteStream(destPath);
          res.pipe(ws);
          ws.on("finish", () => resolve(destPath));
          ws.on("error", reject);
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  async getHLDFromTicket(petKey: string): Promise<string> {
    const petIssue = await this.getIssue(petKey);
    const packageKey = await this.findLinkedPackage(petIssue);

    let att: JiraAttachment | null = null;

    if (packageKey) {
      att = await this.findHLDAttachment(packageKey);
    }

    if (!att) {
      att = await this.findHLDAttachment(petKey);
    }

    if (!att) {
      throw new Error(
        `No HLD .docx attachment found on ${packageKey || petKey}`
      );
    }

    return this.downloadAttachment(att);
  }

  async postComment(issueKey: string, body: string): Promise<void> {
    const url = `${this.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
    const postData = JSON.stringify({ body });

    return new Promise((resolve, reject) => {
      const mod = url.startsWith("https") ? https : http;
      const parsed = new URL(url);
      const req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: "POST",
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
          timeout: 30000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`Failed to post comment: ${res.statusCode}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  }
}
