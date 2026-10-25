# Existing iframe runtime supplies FastAPI/httpx/openai/dashscope/FFmpeg.
FROM iframe-backend:git-8fed521b8bf4
RUN pip install --no-cache-dir aiortc==1.15.0 av==14.2.0 redis==8.1.0 \
    edge-tts==7.3.1 opencv-python-headless==4.11.0.86 numpy==1.26.4 loguru
WORKDIR /mock/source
ENTRYPOINT ["python", "/mock/start.py"]
