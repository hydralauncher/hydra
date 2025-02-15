import axios from "axios";

export interface GofileAccountsReponse {
  id: string;
  token: string;
}

export interface GofileContentChild {
  id: string;
  link: string;
}

export interface GofileContentsResponse {
  id: string;
  type: string;
  children: Record<string, GofileContentChild>;
}

export const WT = "4fd6sg89d7s6";

export class GofileApi {
  private static token: string;

  public static async authorize() {
    const response = await axios.post<{
      status: string;
      data: GofileAccountsReponse;
    }>("https://api.gofile.io/accounts");

    if (response.data.status === "ok") {
      this.token = response.data.data.token;
      return this.token;
    }

    throw new Error("Failed to authorize");
  }

  public static async getDownloadLink(id: string) {
    const searchParams = new URLSearchParams({
      wt: WT,
    });

    const response = await axios.get<{
      status: string;
      data: GofileContentsResponse;
    }>(`https://api.gofile.io/contents/${id}?${searchParams.toString()}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (response.data.status === "ok") {
      if (response.data.data.type !== "folder") {
        throw new Error("Only folders are supported");
      }

      const [firstChild] = Object.values(response.data.data.children);
      return firstChild.link;
    }

    throw new Error("Failed to get download link");
  }

  public static async checkDownloadUrl(url: string) {
    return axios.head(url, {
      headers: {
        Cookie: `accountToken=${this.token}`,
      },
    });
  }
}
