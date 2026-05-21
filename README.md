# Threads Pro Downloader

Extensao Chrome MV3 para baixar imagens e videos de perfis do Threads a partir das requisicoes GraphQL feitas pela propria pagina.

## Recursos

- Detecta a sessao ativa do Threads por meio de requisicoes GraphQL.
- Baixa imagens e videos usando a API `chrome.downloads`.
- Organiza os arquivos em uma pasta com o nome do perfil.
- Mostra progresso no popup da extensao.
- Permite pausar, continuar e cancelar o processo.

## Como instalar localmente

1. Abra `chrome://extensions/` no Chrome.
2. Ative o `Modo do desenvolvedor`.
3. Clique em `Carregar sem compactacao`.
4. Selecione esta pasta do projeto.

## Como usar

1. Abra um perfil do Threads em `threads.net` ou `threads.com`.
2. Recarregue a pagina para permitir que a extensao capture a requisicao necessaria.
3. Abra o popup da extensao.
4. Clique em `INICIAR DOWNLOAD`.

Os arquivos serao salvos pelo Chrome na pasta padrao de downloads, dentro de uma subpasta com o nome do perfil.

## Observacoes

- A extensao depende de endpoints internos do Threads. Mudancas no formato das respostas ou dos parametros GraphQL podem exigir ajustes no codigo.
- O contador considera apenas downloads concluidos pelo Chrome.
- A sessao capturada e limpa ao cancelar ou concluir o processo para reduzir o risco de reutilizar dados antigos.

## Estrutura

- `manifest.json`: configuracao da extensao Chrome.
- `background.js`: captura requisicoes, pagina resultados e dispara downloads.
- `popup.html`: interface do popup.
- `popup.js`: validacao da aba atual e controle da interface.
- `icons/`: icones da extensao.

## Desenvolvimento

Validacoes rapidas:

```bash
node --check background.js
node --check popup.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```
