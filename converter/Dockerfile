FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-calc python3 python3-pip python3-uno fonts-crosextra-carlito fonts-liberation ca-certificates \
  && pip3 install --break-system-packages --no-cache-dir pdfplumber==0.11.7 ezdxf==1.4.4 shapely==2.1.2 Pillow==11.3.0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.py cnc_pdf.py panel_cad.py cad_ai.py entrypoint.sh ./
RUN chmod 0755 /app/entrypoint.sh \
  && useradd --uid 10001 --create-home --shell /usr/sbin/nologin converter

USER converter
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD python3 -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8080')+'/health',timeout=3)"
ENTRYPOINT ["/app/entrypoint.sh"]
