import { requestWebPage } from "@main/helpers";

export class QiwiApi {
  public static async getDownloadUrl(url: string) {
    const document = await requestWebPage(url);
    const fileName = document.querySelector("h1")?.textContent;

    const slug = url.split("/").pop();
    const extension = fileName?.split(".").pop();

    const downloadUrl = `https://spyderrock.com/${slug}.${extension}`;

    return downloadUrl;
  }
}
