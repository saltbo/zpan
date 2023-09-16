FROM debian:10

RUN apt-get update \
    && apt-get install -y ca-certificates telnet procps curl

ENV APP_HOME /srv
WORKDIR $APP_HOME

COPY bin/zpan $APP_HOME

CMD ["./zpan", "server"]