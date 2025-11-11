import { ProxyConfig } from "@types";
import { logger } from "./logger";
import { exec } from "child_process";
import { promisify } from "util";
import { SocksProxyAgent } from "socks-proxy-agent";

const execAsync = promisify(exec);
type ExecResult = { stdout: string };

export class ProxyManager {
  private static currentProxyConfig: ProxyConfig = { mode: "direct" };

  /**
   * Get system proxy settings
   */
  public static async getSystemProxy(): Promise<{
    host: string;
    port: number;
  } | null> {
    try {
      if (process.platform === "win32") {
        return await this.getWindowsSystemProxy();
      } else if (process.platform === "darwin") {
        return await this.getMacOSSystemProxy();
      } else if (process.platform === "linux") {
        return await this.getLinuxSystemProxy();
      }
    } catch (error) {
      logger.error("Failed to get system proxy", error);
    }
    return null;
  }

  /**
   * Get Windows system proxy from registry
   */
  private static async getWindowsSystemProxy(): Promise<{
    host: string;
    port: number;
  } | null> {
    try {
      const { stdout: enabledStdout } = await execAsync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable'
      );

      const proxyEnabled = enabledStdout.includes("0x1");

      // Try ProxyServer when enabled
      if (proxyEnabled) {
        const { stdout: proxyServer } = await execAsync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer'
        );

        const match = proxyServer.match(/ProxyServer\s+REG_SZ\s+(.+)/);
        if (match && match[1]) {
          const proxyString = match[1].trim();

          // Possible formats:
          //  - host:port
          //  - http=host:port;https=host:port;ftp=host:port;socks=host:port
          const entries = proxyString.split(";").map((s) => s.trim());

          // Prefer https entry for HTTPS endpoints if available
          const httpsEntry = entries.find((e) => {
            return e.toLowerCase().startsWith("https=");
          });
          const httpEntry = entries.find((e) => {
            return e.toLowerCase().startsWith("http=");
          });
          const socksEntry = entries.find((e) => {
            return e.toLowerCase().startsWith("socks=");
          });
          const genericEntry = entries.find((e) => {
            return !e.includes("=") && e.includes(":");
          });

          if (socksEntry) {
            // Windows system proxy "socks=" is not directly supported via axios proxy option
            logger.warn(
              "System proxy reports a SOCKS proxy. SOCKS is not supported in System mode. Please use Manual mode with SOCKS.",
              { proxyString }
            );
            return null;
          }

          const target = httpsEntry || httpEntry || genericEntry;
          if (target) {
            const value = target.replace(/^https?=/i, "").trim();
            const [host, port] = value.split(":");
            if (host && port) {
              logger.log("Detected Windows system proxy", { host, port });
              return { host, port: parseInt(port, 10) };
            }
          }
        }
      }

      // If ProxyServer not enabled, check for PAC/auto-detect
      const pacQuery: ExecResult = await execAsync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoConfigURL'
      ).catch(() => ({ stdout: "" }) as ExecResult);
      const pacMatch = pacQuery.stdout.match(/AutoConfigURL\s+REG_SZ\s+(.+)/);
      if (pacMatch && pacMatch[1]) {
        const pacUrl = pacMatch[1].trim();
        logger.warn(
          "Detected Windows PAC (AutoConfigURL). PAC is not supported in System mode; please switch to Manual proxy.",
          { pacUrl }
        );
        return null;
      }

      // Fallback to WinHTTP proxy (some tools set only WinHTTP)
      const winhttpQuery: ExecResult = await execAsync(
        "netsh winhttp show proxy"
      ).catch(() => ({ stdout: "" }) as ExecResult);

      if (
        winhttpQuery.stdout &&
        /Proxy Server\s*:\s*(.+)/i.test(winhttpQuery.stdout)
      ) {
        const m = winhttpQuery.stdout.match(/Proxy Server\s*:\s*(.+)/i);
        const s = m?.[1]?.trim();
        if (s && s.toLowerCase() !== "direct access (no proxy server)") {
          const first = s.split(";")[0];
          const value = first.replace(/^https?=|^http=/i, "").trim();
          const [host, port] = value.split(":");
          if (host && port) {
            logger.log("Detected WinHTTP proxy fallback", { host, port });
            return { host, port: parseInt(port, 10) };
          }
        }
      }
    } catch (error) {
      logger.error("Failed to get Windows system proxy", error);
    }
    return null;
  }

  /**
   * Get macOS system proxy
   */
  private static async getMacOSSystemProxy(): Promise<{
    host: string;
    port: number;
  } | null> {
    try {
      const { stdout } = await execAsync("scutil --proxy");
      const httpProxyHost = stdout.match(/HTTPProxy\s*:\s*(.+)/)?.[1]?.trim();
      const httpProxyPort = stdout.match(/HTTPPort\s*:\s*(\d+)/)?.[1];

      if (httpProxyHost && httpProxyPort) {
        return {
          host: httpProxyHost,
          port: parseInt(httpProxyPort, 10),
        };
      }
    } catch (error) {
      logger.error("Failed to get macOS system proxy", error);
    }
    return null;
  }

  /**
   * Get Linux system proxy from environment variables
   */
  private static async getLinuxSystemProxy(): Promise<{
    host: string;
    port: number;
  } | null> {
    try {
      const httpProxy =
        process.env.https_proxy ||
        process.env.HTTPS_PROXY ||
        process.env.http_proxy ||
        process.env.HTTP_PROXY;

      if (httpProxy) {
        const url = new URL(httpProxy);
        return {
          host: url.hostname,
          port: parseInt(url.port, 10) || 80,
        };
      }
    } catch (error) {
      logger.error("Failed to get Linux system proxy", error);
    }
    return null;
  }

  /**
   * Set the current proxy configuration
   */
  public static setProxyConfig(config: ProxyConfig) {
    this.currentProxyConfig = config;
    logger.log("Proxy configuration updated", config);
  }

  /**
   * Get the current proxy configuration
   */
  public static getProxyConfig(): ProxyConfig {
    return this.currentProxyConfig;
  }

  /**
   * Convert proxy config to axios proxy object
   */
  public static async getAxiosProxyConfig(): Promise<
    | {
        protocol?: string;
        host: string;
        port: number;
        auth?: { username: string; password: string };
      }
    | false
  > {
    const config = this.currentProxyConfig;

    if (config.mode === "direct") {
      return false;
    }

    if (config.mode === "system") {
      const systemProxy = await this.getSystemProxy();
      if (!systemProxy) {
        logger.warn("System proxy not found, using direct connection");
        return false;
      }

      // If user explicitly marked system proxy as SOCKS, do not use axios proxy option
      if (config.protocol?.startsWith("socks")) {
        return false;
      }

      return {
        host: systemProxy.host,
        port: systemProxy.port,
      };
    }

    if (config.mode === "manual") {
      if (!config.host || !config.port) {
        logger.warn("Manual proxy config incomplete, using direct connection");
        return false;
      }

      const proxyConfig: {
        protocol?: string;
        host: string;
        port: number;
        auth?: { username: string; password: string };
      } = {
        host: config.host,
        port: config.port,
      };

      if (config.protocol) {
        proxyConfig.protocol = config.protocol;
      }

      if (config.username && config.password) {
        proxyConfig.auth = {
          username: config.username,
          password: config.password,
        };
      }

      return proxyConfig;
    }

    return false;
  }

  /**
   * Return axios agent config when needed (e.g., SOCKS manual proxy)
   */
  public static async getAxiosAgentConfig(): Promise<
    | {
        httpAgent?: import("http").Agent;
        httpsAgent?: import("https").Agent;
      }
    | Record<string, never>
  > {
    const config = this.currentProxyConfig;
    // Manual SOCKS: build agent; System + SOCKS hint: also build agent using detected host/port
    if (
      config.mode !== "manual" &&
      !(config.mode === "system" && config.protocol?.startsWith("socks"))
    ) {
      return {} as Record<string, never>;
    }

    if (config.protocol?.startsWith("socks")) {
      let host = config.host;
      let port = config.port;

      if (config.mode === "system") {
        const systemProxy = await this.getSystemProxy();
        if (!systemProxy) return {} as Record<string, never>;
        host = systemProxy.host;
        port = systemProxy.port;
      }

      if (!host || !port) return {} as Record<string, never>;

      const authPart =
        config.username && config.password
          ? `${config.username}:${config.password}@`
          : "";
      const socksUrl = `${config.protocol}://${authPart}${host}:${port}`;
      const agent = new SocksProxyAgent(socksUrl);
      return { httpAgent: agent, httpsAgent: agent };
    }

    return {} as Record<string, never>;
  }

  /**
   * Convert proxy config to URL string format
   */
  public static async getProxyUrl(): Promise<string | null> {
    const proxyConfig = await this.getAxiosProxyConfig();

    if (!proxyConfig) {
      return null;
    }

    const protocol = proxyConfig.protocol || "http";
    let proxyUrl = `${protocol}://`;

    if (proxyConfig.auth) {
      proxyUrl += `${proxyConfig.auth.username}:${proxyConfig.auth.password}@`;
    }

    proxyUrl += `${proxyConfig.host}:${proxyConfig.port}`;

    return proxyUrl;
  }
}
