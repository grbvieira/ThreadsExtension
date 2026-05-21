# Threads Pro Downloader

Extensão Chrome MV3 para fins educacionais que demonstra como capturar requisições GraphQL feitas pela página do Threads e salvar mídias localmente em uma pasta escolhida pelo usuário.

## Aviso

Este projeto é apenas educacional. Use por sua própria conta e risco, respeitando os termos de uso do Threads, direitos autorais, privacidade e legislação aplicável.

Os autores e colaboradores não se responsabilizam por uso indevido, bloqueios de conta, perda de dados, violação de termos de serviço ou qualquer outro dano direto ou indireto causado pelo uso deste código.

## Recursos

- Captura a sessão GraphQL ativa do Threads.
- Valida se a sessão capturada pertence ao perfil aberto antes de iniciar.
- Permite escolher uma pasta de destino com a File System Access API.
- Cria uma subpasta por perfil dentro da pasta escolhida.
- Permite baixar tudo, apenas imagens ou apenas vídeos.
- Mantém o processo de download em um documento offscreen para reduzir interrupções do service worker MV3.
- Evita sobrescrever arquivos existentes, usando sufixos como `_1`, `_2`, `_3`.
- Mostra progresso no popup e permite pausar, retomar ou cancelar.

## Como instalar localmente

1. Abra `chrome://extensions/` no Chrome.
2. Ative o `Modo do desenvolvedor`.
3. Clique em `Carregar sem compactação`.
4. Selecione esta pasta do projeto.

## Como usar

1. Abra um perfil do Threads em `threads.net` ou `threads.com`.
2. Recarregue a página para permitir que a extensão capture a requisição necessária.
3. Abra o popup da extensão.
4. Escolha a pasta de destino.
5. Selecione o tipo de mídia: `TUDO`, `IMAGENS` ou `VÍDEOS`.
6. Clique em `INICIAR DOWNLOAD`.

Os arquivos serão salvos na pasta escolhida, dentro de uma subpasta com o nome do perfil.

## Observações

- A extensão depende de endpoints internos do Threads. Mudanças no formato das respostas ou dos parâmetros GraphQL podem exigir ajustes no código.
- Se a extensão informar que a sessão pertence a outro perfil, recarregue o perfil atual e tente novamente.
- O seletor de pasta depende da File System Access API, disponível em navegadores Chromium.
- A pasta escolhida é salva no IndexedDB da extensão e pode ser esquecida pelo botão `ESQUECER`.

## Estrutura

- `manifest.json`: configuração da extensão Chrome.
- `src/background/background.js`: captura requisições GraphQL, valida sessão e orquestra o offscreen.
- `src/offscreen/offscreen.html`: documento offscreen usado para manter o processo de download ativo.
- `src/offscreen/offscreen.js`: pagina resultados, filtra mídias e grava arquivos na pasta escolhida.
- `src/shared/shared.js`: utilitários compartilhados de IndexedDB, permissões, nomes e URLs.
- `src/popup/popup.html`: interface do popup.
- `src/popup/popup.js`: valida a aba atual, gerencia pasta escolhida e envia comandos ao background.
- `icons/`: ícones da extensão.

## Desenvolvimento

Validações rápidas:

```bash
node --check src/background/background.js
node --check src/offscreen/offscreen.js
node --check src/popup/popup.js
node --check src/shared/shared.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```
