# Para hospedar o servidor de graça num Hugging Face Space (SDK: Docker, hardware CPU básico).
# Só CPU: cada música leva alguns minutos. O YouTube costuma bloquear IPs de nuvem;
# nesse caso, envie um cookies.txt e defina a variável YTDLP_COOKIES (veja o README).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nodejs && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PORT=7860 MOISES_DATA=/home/user/data DEMUCS_SHIFTS=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt \
 && python -c "from demucs.pretrained import get_model; get_model('htdemucs_6s')"

COPY --chown=user main.py .
EXPOSE 7860
CMD ["python", "main.py"]
