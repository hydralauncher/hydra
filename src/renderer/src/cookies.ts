export function addCookieInterceptor() {
  Object.defineProperty(document, "cookie", {
    enumerable: true,
    configurable: true,
    get() {
      return localStorage.getItem("cookies") || "";
    },
    set(cookieString) {
      try {
        const [cookieName, cookieValue] = cookieString.split(";")[0].split("=");

        const currentCookies = localStorage.getItem("cookies") || "";

        const cookiesObject = parseCookieStringsToObjects(currentCookies);
        cookiesObject[cookieName] = cookieValue;

        const newString = Object.entries(cookiesObject)
          .map(([key, value]) => {
            return key + "=" + value;
          })
          .join("; ");

        localStorage.setItem("cookies", newString);
      } catch (err) {
        console.error(err);
      }
    },
  });
}

const parseCookieStringsToObjects = (
  cookieStrings: string
): { [key: string]: string } => {
  const result = {};

  if (cookieStrings === "") return result;

  cookieStrings.split(";").forEach((cookieString) => {
    const [name, value] = cookieString.split("=");
    result[name.trim()] = value.trim();
  });

  return result;
};
