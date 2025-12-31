// Definição de Tipos para o resultado
type VDFValue = string | number | VDFObject | VDFArray;
interface VDFObject {
  [key: string]: VDFValue;
}
type VDFArray = VDFObject[];

// O resultado agora é uma tupla simples de JavaScript [string, object | array]
type SimpleVDFParseResult = [string, VDFObject | VDFArray];

/**
 * Função para analisar o conteúdo de um arquivo VDF (Valve Data Format).
 * Retorna uma tupla simples [fileName, dataObject|dataArray].
 *
 * @param vdfContent O conteúdo completo do arquivo VDF como string.
 * @returns {SimpleVDFParseResult} Uma tupla de dois elementos (Array JavaScript).
 */
function parseVDF(vdfContent: string): SimpleVDFParseResult {
  // 1. Pré-processamento: Separar em linhas, remover espaços e comentários
  const lines = vdfContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));

  if (lines.length === 0) {
    return ["", {}];
  }

  // 2. Extrair o nome do arquivo (Chave raiz)
  const fileNameMatch = lines[0].match(/^"([^"]+)"/);
  const fileName = fileNameMatch ? fileNameMatch[1].toLowerCase() : "";

  // 3. Conteúdo para parsing
  const contentLines = lines.slice(1);

  const stack: { key: string; object: VDFObject }[] = [];
  const root: VDFObject = {};
  let currentObject: VDFObject = root;
  let currentKey = fileName;

  // Inicializa o objeto raiz
  root[fileName] = {};
  currentObject = root[fileName] as VDFObject;

  // 4. Iterar pelas linhas do conteúdo para parsing
  for (const line of contentLines) {
    // Padrão 1: Par chave-valor -> "chave"		"valor"
    const keyValueMatch = line.match(/^"([^"]+)"\s+"([^"]*)"$/);

    // Padrão 2: Chave que abre um novo bloco -> "chave"
    const keyBlockMatch = line.match(/^"([^"]+)"$/);

    if (keyValueMatch) {
      // É um par chave-valor
      const key = keyValueMatch[1];
      let value: VDFValue = keyValueMatch[2];

      // Tenta converter o valor para número
      if (!isNaN(Number(value)) && value.trim() !== "") {
        value = Number(value);
      }
      currentObject[key] = value;
    } else if (keyBlockMatch) {
      // É uma chave que abre um novo bloco
      const newKey = keyBlockMatch[1];

      // Salva o objeto atual na pilha
      stack.push({ key: currentKey, object: currentObject });

      // Cria e define o novo objeto aninhado
      currentObject[newKey] = {};
      currentObject = currentObject[newKey] as VDFObject;
      currentKey = newKey;
    } else if (line === "}") {
      // Fim do bloco: retorna ao objeto anterior
      if (stack.length > 0) {
        const previous = stack.pop()!;
        currentObject = previous.object;
        currentKey = previous.key;
      }
    }
  }

  // 5. Verificação e Conversão para Array (para o caso libraryfolders)
  let finalData = root[fileName];

  // Se o objeto final contiver apenas chaves que são strings numéricas sequenciais,
  // converte-o para um Array (permitindo usar map, forEach, etc.)
  if (
    typeof finalData === "object" &&
    finalData !== null &&
    !Array.isArray(finalData)
  ) {
    const keys = Object.keys(finalData);
    const isArrayLike = keys.every((key, index) => key === String(index));

    if (isArrayLike) {
      const dataArray = keys.map(
        (key) => (finalData as VDFObject)[key]
      ) as VDFArray;
      finalData = dataArray as unknown as VDFObject;
    }
  }

  // 6. Retorna a tupla simples [fileName, dataObject|dataArray]
  return [fileName, finalData as VDFObject | VDFArray];
}

export default parseVDF;
export type { SimpleVDFParseResult, VDFObject, VDFArray, VDFValue };
