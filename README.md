# The Lacorte’s — site de casamento

Projeto completo da versão editorial do site de Evelin e Guilherme, com as fotografias, fontes, estilos, lista de presentes, confirmação de presença e painel dos noivos.

## Abrir no VS Code

1. Extraia este ZIP.
2. No VS Code, escolha Arquivo → Abrir Pasta e selecione `site-lacortes`.

## Executar no computador

Requer Node.js 24 ou superior.

No terminal do VS Code, execute:

```sh
npm install
npm start
```

Abra http://127.0.0.1:4173 no navegador.

O painel fica em http://127.0.0.1:4173/admin. Na primeira execução, a senha inicial é exibida no terminal; guarde-a.

## Arquivos principais

- `public/index.html`: conteúdo e estrutura da página.
- `public/editorial.css`: aparência da versão atual.
- `public/app.js`: navegação, presentes e confirmação de presença.
- `public/assets/`: fotografias e ilustrações.
- `public/fonts/`: fontes da identidade visual.
- `config.mjs`: dados do casamento e listas iniciais de exemplo.
- `server.mjs`: servidor local, formulários e painel dos noivos.
- `pix.mjs`: geração do código Pix.

A instalação cria sua própria pasta `data/` com o banco local e os convidados fictícios de avaliação. Os registros da sessão atual e as dependências instaladas não fazem parte deste pacote.

O site usa um servidor local. Para os formulários e presentes funcionarem, inicie-o com `npm start` em vez de abrir o HTML diretamente.

## Presentes por Pix ou produto

Nos itens do lar, o convidado pode escolher entre Pix e produto. No painel, em **Catálogo de presentes → Editar**, habilite **Permitir presentear com o produto** e cadastre o endereço HTTPS do produto na loja. Sem um endereço específico, o botão identifica e abre uma busca pelo nome do item na Amazon. O valor do catálogo é uma sugestão para Pix; o preço de compra é o informado pela loja.

A compra e o pagamento do produto acontecem na loja. Abrir o link não reserva o item nem confirma seu recebimento no painel; o convidado pode combinar modelo e entrega pelo WhatsApp. As contribuições por Pix continuam registradas e conferidas manualmente.

No pacote estático, os links podem ser definidos no sexto campo opcional de cada item de `initialGifts`, em `config.mjs`: `{ physical_enabled: true, product_url: 'https://loja.com.br/produto' }`. Depois, gere o pacote novamente. No projeto completo, essas configurações são salvas pelo painel e preservadas nas atualizações.


## Publicar no Netlify

### Enviando uma pasta diretamente

Use o pacote separado `site-lacortes-netlify-envio-direto.zip`. Extraia-o e envie a pasta que contém `index.html` diretamente para a área de deploy do Netlify.

Para gerar novamente este pacote após editar o site, execute `npm run build:static` e envie a pasta `dist`.

Este pacote mantém as fotos, o catálogo de presentes, o QR Code e o Pix Copia e Cola. A confirmação é feita pelo botão do WhatsApp. O painel administrativo e os registros de respostas não são publicados por esse método.

### Publicar o projeto completo, com confirmação e painel

Esta versão inclui `netlify.toml`, um build para `dist/` e a função `netlify/functions/api.mjs`. As respostas são salvas no Netlify Blobs, fora da pasta pública. Não é necessário provisionar um banco externo.

Opção pelo VS Code:

1. Abra a pasta `site-lacortes` no VS Code.
2. No terminal, execute `npm install`.
3. Execute `npx netlify login` e entre na sua conta pelo navegador.
4. Execute `npx netlify link` e selecione o projeto do seu site já criado no Netlify.
5. No painel do Netlify, em Project configuration → Environment variables, adicione `LACORTES_ADMIN_PASSWORD` com uma senha escolhida por você, de pelo menos 12 caracteres. Disponibilize a variável para as Functions. Não coloque sua senha em arquivos públicos ou no repositório.
6. Execute `npx netlify deploy --build --prod`.
7. Abra a URL retornada e entre em `/admin` com a senha que você definiu.

Você também pode conectar um repositório GitHub com esta pasta. Use comando de build `npm run build` e diretório de publicação `dist`. O `netlify.toml` já define essas configurações.

Ao publicar o projeto completo, o site mantém a busca pelo nome do convite, o limite de acompanhantes, a confirmação de presença, os recados, a lista editável de presentes, o painel e a exportação CSV. Os pagamentos continuam sendo conferidos manualmente.

Os dados locais do SQLite não são enviados automaticamente. A primeira execução hospedada começa com as listas fictícias de avaliação de `config.mjs`; o painel permite substituí-las. Após a primeira entrada no painel, a senha é guardada como hash no armazenamento privado. Mudar a variável no Netlify não altera uma senha já cadastrada; use a alteração de senha do próprio painel.

### Conferir antes de publicar

```sh
npm test
npm run build
```

A pasta `dist` é gerada apenas com os arquivos públicos. Banco local, segredos, testes e código do servidor ficam fora dela.
