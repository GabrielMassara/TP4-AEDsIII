## 1. Integrantes do grupo

**Participantes:** Pedro Henrique Cardoso Maia, Gabriel Egídio Santos Beloni, Gabriel Evangelista Massara, Thiago Aurélio Nunes Martins

## 2. Descrição geral do sistema

O sistema é uma aplicação web (HTML + CSS + JavaScript puro, sem backend) que simula, de forma visual e interativa, o funcionamento de um **arquivo de dados binário com acesso randômico**, no mesmo modelo trabalhado em AEDs III (registros de tamanho fixo, lápide de exclusão lógica, cabeçalho com próximo ID, leitura/escrita byte a byte em big-endian).

A aplicação é dividida em três grandes telas (abas):

1. **Tabelas** – onde o usuário define dinamicamente o *schema* (estrutura) de uma "tabela"/arquivo binário, escolhendo os campos, seus tipos e tamanhos.
2. **CRUD** – onde o usuário insere, altera, exclui e busca registros dentro do arquivo binário gerado a partir do schema escolhido.
3. **Visualizador Hex** – onde o conteúdo binário real do "arquivo" (armazenado como `Uint8Array` no `localStorage` do navegador) é exibido byte a byte, em hexadecimal, com cores indicando a qual campo cada byte pertence, possibilitando inspecionar exatamente como cada registro foi serializado.

Não existe nenhum servidor: cada "arquivo" é simulado como um array de bytes (`Uint8Array`) persistido no `localStorage` do navegador, e todas as operações de CRUD manipulam esses bytes diretamente (não objetos JSON), reproduzindo o comportamento de um `RandomAccessFile` em Java.

---

## 3. Estrutura dos arquivos do projeto

```
index.html   → estrutura das telas (abas Tabelas / CRUD / Hex), modais de criação de tabela
styles.css   → tema claro/escuro (CSS variables), estilo do visualizador hex, cards, formulários
script.js    → toda a lógica: schemas dinâmicos, conversão de bytes, CRUD binário, visualizador hex
```

---

## 4. "Classes" / módulos criados (script.js)

Como o trabalho foi feito em JavaScript puro, a lógica foi organizada em **objetos e grupos de funções com responsabilidade única**, equivalentes às classes que seriam criadas em uma versão Java do projeto:

| Módulo / objeto | Responsabilidade |
|---|---|
| `BC` (Byte Converter) | Conversão de todos os tipos primitivos (`int8/16/32/64`, `float`, `double`, `char`, `boolean`, `date`, `string`) de/para bytes, sempre em **big-endian**, igual ao `DataOutputStream`/`DataInputStream` do Java |
| `schemas` (array de schema) | Representa o catálogo de tabelas criadas pelo usuário, cada uma com nome, lista de campos (`name`, `type`, `size`, `autoIncrement`) e `recordSize` |
| Funções de schema (`computeRecordSize`, `fieldOffsetInRecord`, `getAutoIncrField`, `getSchema`) | Calculam o layout binário do registro (tamanho total, offset de cada campo) |
| Funções de arquivo (`getOrInitFile`, `initFile`, `saveFile`, `loadFile`, `getNextId`, `setNextId`, `numRecords`, `recOffset`) | Simulam a manipulação do arquivo binário: cabeçalho de 4 bytes com o próximo ID, cálculo de quantos registros existem e em qual offset cada um está |
| `buildRecordBytes` / `readRecord` / `readFieldVal` | Serializam um registro (objeto → bytes) e desserializam (bytes → objeto), aplicando a lápide de validade no primeiro byte |
| **Camada de CRUD binário**: `opCreate`, `opReadAll`, `opFindById`, `opUpdate`, `opDelete` | Implementam as operações de Create, Read, Update, Delete diretamente sobre os bytes do arquivo |
| **Camada de Hex Viewer**: `buildByteMap`, `byteStyle`, `renderHexViewer`, `renderRecordStrip`, `renderHexContent`, `renderLegend`, `onByteHover`, `onByteClick` | Constroem um mapa byte-a-byte do arquivo (cabeçalho / lápide / campo de qual registro) e renderizam a visualização hexadecimal interativa, com legenda de cores e painel de inspeção de byte |
| **Camada de UI de schema**: `renderSchemas`, `openAddTableModal`, `editTable`, `addFieldRow`, `collectFields`, `updatePreview`, `saveTable`, `confirmDeleteTable` | Controlam o modal de criação/edição de tabelas e a pré-visualização do layout do registro |
| **Camada de UI de CRUD**: `renderCrudForm`, `setCrudMode`, `executeCrud`, `loadCrudResults`, `fillForEdit`, `quickDelete` | Geram dinamicamente o formulário de acordo com os campos do schema e com o modo (inserir/alterar/excluir/buscar), e listam os registros válidos em uma tabela |
| `loadExample`, `clearAllData` | Geram dados de exemplo (tabelas `produto` e `usuario`) e permitem limpar todo o `localStorage` |
| `applyTheme`, `toggleTheme`, `initTheme` | Alternância entre tema claro e escuro |

---

## 5. Funcionalidades detalhadas

### 5.1 Criação dinâmica de tabelas (aba "Tabelas")
O usuário não está restrito a uma tabela fixa de produtos: ele pode criar **qualquer schema**, escolhendo o nome de cada campo, seu tipo (`int8`, `int16`, `int32`, `int64`, `float`, `double`, `char`, `boolean`, `date`, `string`) e, para campos de tamanho variável (`string`), o tamanho em bytes. Tipos numéricos e `date` têm tamanho fixo (calculado automaticamente). Cada campo pode ser marcado como **auto-incremento** (chave primária gerada automaticamente). O sistema mostra em tempo real o layout do registro (offset de cada campo) antes de salvar.

### 5.2 CRUD (aba "CRUD")
Para a tabela selecionada, o usuário pode:
- **Inserir** um novo registro (o campo de auto-incremento é preenchido automaticamente com o próximo ID, lido do cabeçalho do arquivo);
- **Alterar** um registro existente a partir do ID;
- **Excluir** um registro (exclusão lógica, ver seção 6);
- **Buscar** um registro pelo ID.

A tabela de resultados é recarregada automaticamente após cada operação, e cada linha possui atalhos de edição/exclusão rápida.

### 5.3 Visualizador Hex (aba "Visualizador Hex")
Mostra o conteúdo binário real do arquivo selecionado, 16 bytes por linha, no formato offset / bytes em hexadecimal / coluna ASCII — como um hex editor tradicional. Cada byte é colorido conforme seu significado: cabeçalho do arquivo, lápide (válido/excluído) ou o campo específico ao qual pertence. Passando o mouse (ou clicando) sobre um byte, um painel lateral mostra: offset, valor em hex/decimal/binário e, quando aplicável, a qual registro/campo o byte pertence e o valor decodificado daquele campo.

---

## 6. Operações especiais implementadas

- **Lápide de exclusão lógica (`0xFF` / `0x00`)**: cada registro reserva 1 byte inicial como lápide. `0xFF` indica registro válido e `0x00` indica registro excluído. A exclusão (`opDelete`) **não remove bytes do arquivo**, apenas grava `0x00` nessa posição, exatamente como no modelo de arquivos binários ensinado na disciplina.
- **Reaproveitamento de espaço excluído**: ao inserir um novo registro (`opCreate`), o sistema primeiro varre o arquivo em busca de um slot com lápide `0x00`; se encontrar, reaproveita esse espaço em vez de aumentar o arquivo, evitando fragmentação crescente.
- **Cabeçalho de controle de ID**: os 4 primeiros bytes do arquivo armazenam, em big-endian, o próximo ID auto-incremento a ser usado, lido/atualizado a cada inserção (`getNextId`/`setNextId`).
- **Serialização binária por tipo**, fiel ao formato usado em Java (`DataOutputStream`): inteiros e ponto flutuante em big-endian, strings em UTF-8 com padding de zeros até o tamanho fixo do campo, datas codificadas em 6 bytes (ano/mês/dia, 2 bytes cada), booleanos em 1 byte.
- **Mapeamento byte-a-byte (`buildByteMap`)**: para qualquer arquivo, o sistema calcula, para cada byte individual, se ele pertence ao cabeçalho, à lápide de um registro ou a um campo específico — isso é o que permite colorir e explicar cada byte no visualizador hex.
- **Inspeção interativa de byte**: clique/hover em qualquer byte do hex viewer mostra detalhes completos (offset, hex, decimal, binário, campo/registro correspondente e valor decodificado).
- **Filtros do visualizador**: opção de mostrar/ocultar registros excluídos e de mostrar/ocultar o cabeçalho do arquivo.
- **Geração de dados de exemplo**: botão "Exemplo" cria automaticamente as tabelas `produto` (id, nome, descrição, preço, quantidade) e `usuario` (id, nome, email, ativo) já populadas, para facilitar testes/demonstração.
- **Tema claro/escuro**: alternância completa de paleta de cores (incluindo as cores usadas para diferenciar campos no hex viewer), persistida no `localStorage`.
- **Persistência local**: schemas e arquivos binários são salvos no `localStorage` do navegador (`aeds3_schemas`, `aeds3_file_<nome>`), permitindo que os dados sobrevivam ao recarregar a página.

---

## 8. CheckList de Avaliação

- **A página web com a visualização interativa do CRUD de produtos foi criada?**
  Sim. A aba "CRUD" permite inserir, alterar, excluir e buscar registros de qualquer tabela criada (incluindo a tabela de exemplo "produto"), com formulário dinâmico e listagem de resultados em tempo real.

- **Há um vídeo de até 3 minutos demonstrando o uso da visualização?**
  https://drive.google.com/file/d/1KO6jZr2NoI3fAcQsfbmRYH5fzHHuaDLe/view?usp=sharing

- **O trabalho foi criado apenas com HTML, CSS e JS?**
  Sim. O projeto usa apenas `index.html`, `styles.css` e `script.js`, sem qualquer linguagem de backend/servidor.

- **O relatório do trabalho foi entregue no APC?**
  Sim

- **O trabalho está completo e funcionando sem erros de execução?**
  Sim. Todas as funcionalidades descritas (criação de tabelas, CRUD binário e visualizador hex) foram implementadas e testadas

- **O trabalho é original e não a cópia de um trabalho de outro grupo?**
  Sim. Todo o trabalho foi desenvolvido pelos integrantes do grupo.
