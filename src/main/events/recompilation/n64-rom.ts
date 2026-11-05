const Z64_HEADER = 0x80371240;
const V64_HEADER = 0x37804012;
const N64_HEADER = 0x40123780;

export const toZ64 = (data: Buffer) => {
  const header = data.readUInt32BE(0);
  if (header === Z64_HEADER) return data;

  const converted = Buffer.from(data);
  if (header === V64_HEADER) return converted.swap16();
  if (header === N64_HEADER) return converted.swap32();
  throw new Error("not_n64_rom");
};
