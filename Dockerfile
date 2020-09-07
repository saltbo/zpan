FROM moreu:latest

ENV APP_HOME /zpan
WORKDIR $APP_HOME

RUN curl -sSf https://dl.saltbo.cn/install.sh | sh -s zpan

CMD ["zpan", "server"]
