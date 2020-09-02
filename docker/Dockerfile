FROM golang:1.14 AS builder

ENV APP_HOME /src
WORKDIR $APP_HOME

COPY go.* $APP_HOME/
ENV GOPROXY https://goproxy.cn,direct
RUN go mod download

COPY .. .
RUN make build


# Runing environment
FROM moreu:latest

ENV APP_HOME /zpan
WORKDIR $APP_HOME

COPY deployments/ .
COPY docker/entrypoint.sh .
COPY --from=builder /src/build/bin/zpan .

ENTRYPOINT ["./entrypoint.sh"]
CMD ["moreu", "server"]