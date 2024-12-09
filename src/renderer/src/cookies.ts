export function addCookieInterceptor() {
  Object.defineProperty(document, "cookie", {
    enumerable: true,
    configurable: true,
    get() {
      const cookies = localStorage.getItem("cookies") || "";
      console.log("get cookie", cookies);
      return cookies;
    },
    set(cookieString) {
      try {
        console.log("setting cookie", cookieString);
        const [cookieName, cookieValue] = cookieString.split(";")[0].split("=");

        const currentCookies = localStorage.getItem("cookies") || "";

        console.log("pre cookies obj", currentCookies);
        const cookiesObject = parseCookieStringsToObjects(currentCookies);
        cookiesObject[cookieName] = cookieValue;
        console.log("cookiesObject", cookiesObject);

        const newString = Object.entries(cookiesObject)
          .map(([key, value]) => {
            return key + "=" + value;
          })
          .join("; ");

        console.log("set cookie", newString);
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

  console.log(cookieStrings);
  cookieStrings.split(";").forEach((cookieString) => {
    console.log("forEach", cookieString);
    const [name, value] = cookieString.split("=");
    result[name.trim()] = value.trim();
  });

  return result;
};
