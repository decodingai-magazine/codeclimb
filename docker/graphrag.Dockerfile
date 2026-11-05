# codeclimb-graphrag: codeclimb-python plus the graphrag scenario's fixed requirements. Build context is
# scenarios/graphrag; only requirements.txt is copied into the image.
FROM codeclimb-python
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt
