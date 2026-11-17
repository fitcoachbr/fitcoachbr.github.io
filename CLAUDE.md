# Fit Coach — instruções para o Claude

App pessoal (PWA) de nutricionista + personal com IA, para o Guilherme e um colega. Custo zero.

## Estrutura
- `docs/` é o app inteiro (o GitHub Pages publica esta pasta): `index.html`, `styles.css`, `app.js`, `sw.js` (offline), `manifest.webmanifest`, `icons/`.
- JavaScript puro, sem build e sem dependências. Só o leitor de código de barras (`html5-qrcode@2.3.8`) é carregado sob demanda do unpkg.
- Dados: IndexedDB no próprio celular (banco `fitcoach`, store `kv`). Fotos de evolução ficam em chaves `foto:<id>`.
- IA: API do Google Gemini chamada direto do navegador; cada usuário cola a própria chave na aba Eu. A chave nunca entra no código nem no backup.
- Comida por código de barras: API do Open Food Facts.

## Publicação
- Repositório: github.com/fitcoachbr/fitcoachbr.github.io (público, da organização fitcoachbr). Site: https://fitcoachbr.github.io/
- Publicar = commit + `git push` na `main`. O Pages atualiza em 1–2 minutos.
- GitHub CLI: `C:\Program Files\GitHub CLI\gh.exe` (já logado).

## Regras
- Manter o app leve: nada de frameworks ou bibliotecas grandes.
- Ao mudar arquivos do app, subir a versão de `CACHE` em `docs/sw.js` para os celulares receberem a atualização.
- Textos da interface em português do Brasil.
- Testar localmente: `python -m http.server 5173 --directory docs`.
