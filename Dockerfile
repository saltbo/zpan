FROM golang:1.15.7 AS builder

ENV GOPROXY https://goproxy.io,direct
ENV ROOT_PATH /data/zpan
WORKDIR $ROOT_PATH

ADD Makefile go.* $ROOT_PATH/
RUN make mod

COPY . .
RUN make build


# Run environment
FROM debian:10

RUN echo \
    deb http://mirrors.aliyun.com/debian buster main \
    deb http://mirrors.aliyun.com/debian buster-updates main \
    deb http://mirrors.aliyun.com/debian-security buster/updates main \
    > /etc/apt/sources.list
RUN apt-get update \
    && apt-get install -y ca-certificates telnet procps curl

ENV APP_HOME /zpan
WORKDIR $APP_HOME

COPY --from=builder /data/zpan/build $APP_HOME
COPY --from=builder /data/zpan/rbac.yml $APP_HOME

CMD ["./bin/zpan", "server"]