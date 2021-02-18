FROM debian:10

RUN echo \
    deb http://mirrors.aliyun.com/debian buster main \
    deb http://mirrors.aliyun.com/debian buster-updates main \
    deb http://mirrors.aliyun.com/debian-security buster/updates main \
    > /etc/apt/sources.list
RUN apt-get update \
    && apt-get install -y ca-certificates telnet procps curl

ENV APP_HOME /srv
WORKDIR $APP_HOME

COPY zpan $APP_HOME

CMD ["./zpan", "server"]