# Stems Studio

PWA no estilo Moises: escolha um arquivo de áudio e a IA separa **voz, bateria, baixo, piano, guitarra e outros**. Depois é só estudar com o mixer: volume, mute, solo e pan por faixa, velocidade sem mudar o tom, loop A-B e comparação com o original.

Tudo roda **no navegador**. Não existe servidor e nenhum áudio é enviado para a internet. O app é estático e é hospedado de graça na Vercel.

## Como funciona

1. O navegador decodifica o arquivo (MP3, M4A, WAV, FLAC, OGG…) em 44,1 kHz estéreo.
2. Um Web Worker roda o **Demucs `htdemucs_6s`** (Meta, licença MIT), [exportado para ONNX](https://huggingface.co/StemSplitio/htdemucs-6s-onnx), com o **ONNX Runtime Web** em WebAssembly com várias threads. O áudio é processado em janelas de 7,8 s com sobreposição.
3. Cada faixa é codificada em MP3 (até 320 kbps) com lamejs.
4. As faixas, a biblioteca e as playlists ficam salvas no aparelho (IndexedDB) e tocam offline.

O modelo (~136 MB) é baixado do Hugging Face **só na primeira separação** e fica guardado no Cache Storage.

### Desempenho

Num computador com 8 núcleos, cada trecho de 7,8 s leva cerca de 6 s, então uma música de 4 minutos fica pronta em uns 4 minutos. A IA usa por volta de 1 GB de RAM. Em celulares funciona, mas é bem mais lento, e aparelhos com pouca memória podem não conseguir.

## Desenvolvimento

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # gera dist/
npm run preview   # serve dist/ com os headers corretos
```

`npm run dev` e `npm run build` copiam o runtime do ONNX (`.mjs` + `.wasm`) para `public/ort/`. Ele precisa ser servido como arquivo separado; se for empacotado junto com o worker, as threads travam.

## Deploy na Vercel

Importe o repositório. O `vercel.json` já configura:
- o build (Vite → `dist/`);
- os headers `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp`. **Eles são obrigatórios**: sem eles o navegador bloqueia o `SharedArrayBuffer` e a IA roda com um único núcleo, cerca de 3× mais devagar.

## Usando o app

- **Separar**: "Escolher arquivo" ou arraste os arquivos. Dá para enfileirar várias músicas. Mantenha a aba aberta durante o processamento.
- **Playlists**: "+ Playlist" cria uma playlist. O menu ⋮ de cada música adiciona ou remove de playlists e edita título e artista. ▲▼ reordena.
- **Mixer**: M = mute, S = solo (duplo clique no nome = ouvir só aquela faixa), duplo clique no slider volta ao padrão, ↓ baixa a faixa em MP3. A mixagem de cada música fica salva.
- **Atalhos**: espaço = tocar/pausar, ←/→ = 5 s, Esc = voltar.
- **Ajustes**: qualidade do MP3, status do modelo e espaço usado.

O nome do arquivo no formato `Artista - Título.mp3` já preenche o artista e o título.

Use só com músicas que você tem direito de usar.
