export interface NotificationOptions {
  title: string;
  body?: string;
  icon: string;
  duration?: "short" | "long";
  silent?: boolean;
  progress?: {
    status?: string;
    value: number;
    valueOverride: string;
  };
}

function escape(string: string) {
  return string.replace(/[<>&'"]/g, (match) => {
    switch (match) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return "";
    }
  });
}

function addAttributeOrTrim(name: string, value: string) {
  return value ? `${name}="${value}" ` : "";
}

export function toXmlString(options: NotificationOptions) {
  let template =
    "<toast " +
    `displayTimestamp="${new Date().toISOString()}" ` +
    `scenario="default" ` +
    `duration="${options.duration ?? "short"}" ` +
    `activationType="protocol" ` +
    ">";

  //Visual
  template += `<visual><binding template="ToastGeneric">`;
  if (options.icon)
    template += `<image placement="appLogoOverride" src="${options.icon}" hint-crop="none"/>`;
  template +=
    `<text><![CDATA[${options.title}]]></text>` +
    `<text><![CDATA[${options.body}]]></text>`;

  //Progress bar
  if (options.progress) {
    template +=
      "<progress " +
      `value="${options.progress.value}" ` +
      `status="" ` +
      addAttributeOrTrim(
        "valueStringOverride",
        escape(options.progress.valueOverride)
      ) +
      "/>";
  }
  template += "</binding></visual>";

  //Actions
  template += "<actions>";
  template += "</actions>";

  //Audio
  template += "<audio " + `silent="true" ` + `loop="false" ` + "/>";

  //EOF
  template += "</toast>";

  return template;
}
