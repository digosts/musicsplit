# Stems Studio

PWA no estilo Moises: cole um link do YouTube, a IA separa **voz, bateria, baixo, piano, guitarra e outros**, e você estuda com um mixer (volume, mute, solo, pan, velocidade sem mudar o tom, loop A-B, comparar com o original). As músicas e playlists ficam salvas **no próprio aparelho** e tocam offline.

## Como funciona

```
 PWA (Vercel, estático)  ──link──▶  Servidor de separação (Python)
  React + IndexedDB      ◀─MP3s──   yt-dlp + Demucs htdemucs_6s
```

- **frontend/**: React + TypeScript + Vite + vite-plugin-pwa. Publicado na Vercel.
- **backend/**: FastAPI + yt-dlp + [Demucs](https://github.com/facebookresearch/demucs) (modelo `htdemucs_6s`, MP3 320 kbps).
  A Vercel não consegue rodar essa parte (PyTorch passa do limite de tamanho das funções, cada música leva minutos e o YouTube bloqueia IPs da Vercel). Por isso ela roda no seu PC (com GPU) ou num Hugging Face Space gratuito.

Depois que uma música é separada, o app baixa as faixas para o IndexedDB. Daí em diante ela toca mesmo com o servidor desligado.

## 1. Servidor no seu PC (recomendado: rápido, usa a GPU)

Pré-requisitos: Python 3.10+, ffmpeg, Node.js (o yt-dlp usa para o YouTube).

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cu126   # GPU NVIDIA
.\.venv\Scripts\pip install -r requirements.txt
winget install Cloudflare.cloudflared      # túnel HTTPS gratuito
.\start-server.ps1 -Token "uma-senha-sua"
```

O script mostra um endereço `https://xxxx.trycloudflare.com`. No app, abra **Ajustes (⚙)**, cole o endereço e o token, e clique em **Testar e salvar**.
O endereço do túnel rápido muda a cada vez que o script é aberto. Para ter um endereço fixo, use um túnel nomeado da Cloudflare (precisa de um domínio) ou o Tailscale Funnel (gratuito).

Use sempre um token quando o servidor estiver exposto na internet; sem ele, qualquer pessoa com o link pode usar sua GPU.

Variáveis opcionais: `DEMUCS_MODEL` (padrão `htdemucs_6s`; `htdemucs_ft` tem qualidade um pouco melhor, mas só separa 4 faixas, sem piano/guitarra), `DEMUCS_SHIFTS` (padrão 2; mais = melhor e mais lento), `MP3_BITRATE` (padrão 320), `YTDLP_COOKIES`.

## 2. Alternativa: servidor no Hugging Face Spaces (grátis, só CPU)

1. Crie um Space com **SDK: Docker** e envie `backend/Dockerfile`, `backend/main.py` e `backend/requirements.txt`.
2. Em *Settings → Variables and secrets*, crie o secret `API_TOKEN`.
3. Use `https://<usuario>-<space>.hf.space` como endereço no app.

Limitações: na CPU gratuita cada música leva vários minutos, o Space hiberna depois de um tempo sem uso, e o YouTube costuma bloquear IPs de nuvem. Se der erro de "Sign in to confirm you're not a bot", exporte um `cookies.txt` do YouTube, coloque junto no Space e defina `YTDLP_COOKIES=/home/user/app/cookies.txt`.

## 3. Frontend na Vercel

- Importe o repositório na Vercel com **Root Directory = `frontend`** (o `vercel.json` já define o build).
- Opcional: a variável `VITE_API_URL` define o servidor padrão; ele também pode ser trocado em Ajustes.

Para desenvolver localmente: `cd frontend && npm install && npm run dev`.

## Uso

- **Separar**: cole o link → acompanhe o progresso → a música vai para "Todas".
- **Playlists**: "+ Playlist" cria uma; o menu ⋮ de cada música adiciona ou remove de playlists; ▲▼ reordena.
- **Mixer**: M = mute, S = solo (duplo clique no nome = ouvir só ela), duplo clique no slider volta ao padrão, ↓ baixa a faixa. A mixagem de cada música fica salva.
- **Atalhos**: espaço = tocar/pausar, ←/→ = 5 s, Esc = voltar.
- Em Ajustes dá para trazer para outro aparelho as músicas que já estão no servidor.

Use apenas para estudo pessoal, com músicas que você tem direito de usar. Baixar do YouTube pode violar os termos de uso da plataforma.
