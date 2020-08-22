FROM golang:1.14 AS builder

ENV APP_HOME /src
WORKDIR $APP_HOME

COPY go.* $APP_HOME/
ENV GOPROXY https://goproxy.cn,direct
RUN go mod download

COPY . .
RUN make build


# Runing environment
FROM moreu:latest

COPY deployments/ .
COPY --from=builder /src/build/bin/zpan .

ENTRYPOINT ["./entrypoint.sh"]
CMD ["moreu", "server"]