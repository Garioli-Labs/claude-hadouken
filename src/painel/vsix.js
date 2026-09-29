import zlib from 'node:zlib';

// Montagem do .vsix do painel sem dependências (spec E4, Task 4). Um .vsix é
// um zip comum com três partes: extension.vsixmanifest (metadados do pacote),
// [Content_Types].xml (tipos por extensão) e a pasta extension/ com os
// arquivos da extensão. O VS Code instala com `code --install-extension`.
//
// O zip é o mínimo que um leitor exige:
// - cabeçalho local e diretório central por entrada, e o fim (EOCD) sem
//   comentário; nada de zip64, porque o total tem teto de 4 MiB;
// - deflate cru (deflateRawSync, método 8) só quando reduz; senão guardado
//   (método 0);
// - data do DOS fixa em 1980-01-01 00:00 e nenhum campo que dependa do
//   relógio ou do sistema: a mesma entrada dá sempre os mesmos bytes;
// - nomes só ASCII seguro com / entre as partes, sem parte vazia, "." ou "..":
//   o leitor de quem instala nunca escreve fora da pasta da extensão.
// O CRC-32 vem do zlib.crc32 (Node 20.15+ e 22.2+); antes disso, de uma
// tabela daqui (crc32Tabela), com o mesmo resultado.
//
// Nenhuma função exportada lança: entrada inválida ou erro dá null.

export const MAX_ZIP_BYTES = 4 * 1024 * 1024;
export const ID_EXTENSAO = 'claude-hadouken-painel';
export const PUBLICADOR = 'gariolilabs';
export const MOTOR_VSCODE = '^1.90.0';

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
// Versão 2.0 do formato: deflate e pastas, o bastante para qualquer leitor.
const VERSAO_ZIP = 20;
const METODO_GUARDADO = 0;
const METODO_DEFLATE = 8;
// 1980-01-01 00:00 no formato do DOS: hora 0; data (ano - 1980) << 9 | mês << 5 | dia.
const HORA_DOS = 0;
const DATA_DOS = (1 << 5) | 1;
const LOCAL_BYTES = 30;
const CENTRAL_BYTES = 46;
const FIM_BYTES = 22;
const MAX_ENTRADAS = 0xffff;
const MAX_NOME = 255;
// Uma parte do nome: letras e algarismos ASCII, . _ - [ ] (o [Content_Types].xml).
const PARTE_NOME = /^[A-Za-z0-9._\-[\]]+$/;
// Versão do plugin: três números, cada um com até 9 algarismos.
const VERSAO = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Versão aceita no .vsix e nos arquivos do painel: N.N.N. Nunca lança.
export const versaoValida = (v) => typeof v === 'string' && VERSAO.test(v);

let tabela = null;
function tabelaCrc() {
  if (tabela === null) {
    tabela = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c >>> 0;
    }
  }
  return tabela;
}

// CRC-32 do zip (polinômio refletido 0xEDB88320) por tabela: a reserva para o
// Node sem zlib.crc32. Exportado para o teste comparar os dois.
export function crc32Tabela(dados) {
  const t = tabelaCrc();
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = t[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// CRC-32 de um Buffer, sem sinal.
export const crc32 = typeof zlib.crc32 === 'function' ? (dados) => zlib.crc32(dados) >>> 0 : crc32Tabela;

// Nome de entrada aceitável: texto de 1 a 255 caracteres, partes separadas por
// / e cada parte em PARTE_NOME, fora "." e "..".
function nomeValido(nome) {
  if (typeof nome !== 'string' || nome.length === 0 || nome.length > MAX_NOME) return false;
  return nome.split('/').every((p) => PARTE_NOME.test(p) && p !== '.' && p !== '..');
}

// Os campos que o cabeçalho local e o diretório central repetem: versão
// necessária, flags, método, hora, data, CRC e os dois tamanhos.
function camposComuns(buf, pos, e) {
  buf.writeUInt16LE(VERSAO_ZIP, pos);
  buf.writeUInt16LE(0, pos + 2);
  buf.writeUInt16LE(e.metodo, pos + 4);
  buf.writeUInt16LE(HORA_DOS, pos + 6);
  buf.writeUInt16LE(DATA_DOS, pos + 8);
  buf.writeUInt32LE(e.crc, pos + 10);
  buf.writeUInt32LE(e.corpo.length, pos + 14);
  buf.writeUInt32LE(e.tamanho, pos + 18);
  buf.writeUInt16LE(e.nome.length, pos + 22);
  buf.writeUInt16LE(0, pos + 24);
}

// Zip das entradas { nome, dados: Buffer }, na ordem dada. Nome inválido ou
// repetido, dados que não são Buffer, mais de 65535 entradas ou total acima de
// MAX_ZIP_BYTES: null. Nunca lança.
export function montarZip(entradas) {
  try {
    if (!Array.isArray(entradas) || entradas.length > MAX_ENTRADAS) return null;
    const vistos = new Set();
    const prontas = [];
    let total = FIM_BYTES;
    for (const e of entradas) {
      if (!ehObjeto(e)) return null;
      const { nome, dados } = e;
      if (!nomeValido(nome) || vistos.has(nome) || !Buffer.isBuffer(dados) || dados.length > MAX_ZIP_BYTES) return null;
      vistos.add(nome);
      const deflado = zlib.deflateRawSync(dados);
      const metodo = deflado.length < dados.length ? METODO_DEFLATE : METODO_GUARDADO;
      const corpo = metodo === METODO_DEFLATE ? deflado : dados;
      const bytesNome = Buffer.from(nome, 'ascii');
      total += LOCAL_BYTES + CENTRAL_BYTES + 2 * bytesNome.length + corpo.length;
      if (total > MAX_ZIP_BYTES) return null;
      prontas.push({ nome: bytesNome, metodo, corpo, crc: crc32(dados), tamanho: dados.length });
    }
    const partes = [];
    const centrais = [];
    let offset = 0;
    for (const e of prontas) {
      const local = Buffer.alloc(LOCAL_BYTES);
      local.writeUInt32LE(ASSINATURA_LOCAL, 0);
      camposComuns(local, 4, e);
      partes.push(local, e.nome, e.corpo);
      const central = Buffer.alloc(CENTRAL_BYTES);
      central.writeUInt32LE(ASSINATURA_CENTRAL, 0);
      // "Feito por": versão 2.0 no MS-DOS, sem atributos de arquivo.
      central.writeUInt16LE(VERSAO_ZIP, 4);
      camposComuns(central, 6, e);
      // Comentário, disco, atributos internos e externos: zero.
      central.writeUInt32LE(offset, 42);
      centrais.push(central, e.nome);
      offset += LOCAL_BYTES + e.nome.length + e.corpo.length;
    }
    const tamCentral = centrais.reduce((s, b) => s + b.length, 0);
    const fim = Buffer.alloc(FIM_BYTES);
    fim.writeUInt32LE(ASSINATURA_FIM, 0);
    fim.writeUInt16LE(prontas.length, 8);
    fim.writeUInt16LE(prontas.length, 10);
    fim.writeUInt32LE(tamCentral, 12);
    fim.writeUInt32LE(offset, 16);
    return Buffer.concat([...partes, ...centrais, fim]);
  } catch {
    return null;
  }
}

// Texto que vai dentro de um atributo ou elemento XML: os cinco caracteres
// especiais viram entidade, e os controles C0 que o XML 1.0 não aceita saem.
const ENTIDADES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });
const xml = (texto) => texto.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, (c) => ENTIDADES[c]);

const TIPOS = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".cjs" ContentType="application/javascript" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
  <Default Extension=".xml" ContentType="text/xml" />
</Types>
`;

// Manifesto do pacote. Identidade, alvo, motor e o Asset do package.json são
// fixos; a versão já foi validada (N.N.N) e nome e descrição, vindos do
// package.json da extensão, entram escapados.
function manifesto(versao, nome, descricao) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${ID_EXTENSAO}" Version="${versao}" Publisher="${PUBLICADOR}" />
    <DisplayName>${xml(nome)}</DisplayName>
    <Description xml:space="preserve">${xml(descricao)}</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${MOTOR_VSCODE}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

// O .vsix da extensão: o manifesto, os tipos, extension/package.json com a
// `version` trocada por `versao` (as outras chaves ficam com o valor e a
// ordem de antes) e extension/extension.cjs como veio. `versao` fora de N.N.N,
// package.json que não é objeto JSON ou de outra extensão (name e publisher
// têm de ser os da identidade), fonte que não é texto ou zip acima do teto:
// null. Nunca lança.
export function montarVsix(opcoes) {
  try {
    if (!ehObjeto(opcoes)) return null;
    const { versao, packageJson, extensionCjs } = opcoes;
    if (!versaoValida(versao) || typeof packageJson !== 'string' || typeof extensionCjs !== 'string') return null;
    let pacote;
    try {
      pacote = JSON.parse(packageJson);
    } catch {
      return null;
    }
    if (!ehObjeto(pacote) || pacote.name !== ID_EXTENSAO || pacote.publisher !== PUBLICADOR) return null;
    const nome = typeof pacote.displayName === 'string' ? pacote.displayName : ID_EXTENSAO;
    const descricao = typeof pacote.description === 'string' ? pacote.description : '';
    const final = `${JSON.stringify({ ...pacote, version: versao }, null, 2)}\n`;
    return montarZip([
      { nome: 'extension.vsixmanifest', dados: Buffer.from(manifesto(versao, nome, descricao), 'utf8') },
      { nome: '[Content_Types].xml', dados: Buffer.from(TIPOS, 'utf8') },
      { nome: 'extension/package.json', dados: Buffer.from(final, 'utf8') },
      { nome: 'extension/extension.cjs', dados: Buffer.from(extensionCjs, 'utf8') },
    ]);
  } catch {
    return null;
  }
}
