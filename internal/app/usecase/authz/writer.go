package authz

import (
	"bytes"
	"encoding/json"
	"log"

	"github.com/gin-gonic/gin"
)

type Writer struct {
	gin.ResponseWriter

	Buf bytes.Buffer
}

func NewWriter(rw gin.ResponseWriter) *Writer {
	return &Writer{
		ResponseWriter: rw,
	}
}

func (w *Writer) Write(p []byte) (n int, err error) {
	return w.Buf.Write(p)
}

func (w *Writer) extractResource() any {
	buf := make([]byte, w.Buf.Len())
	copy(buf, w.Buf.Bytes())
	var resource interface{}
	dec := json.NewDecoder(bytes.NewReader(buf))
	dec.UseNumber()
	if err := dec.Decode(&resource); err != nil {
		log.Fatal(err)
	}
	return resource
}

func (w *Writer) WriteNow() {
	_, _ = w.ResponseWriter.Write(w.Buf.Bytes())
}
