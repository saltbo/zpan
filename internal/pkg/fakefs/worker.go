package fakefs

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/app/service"
)

const maxHeadIntervalSec = 5

type Worker struct {
	ch   chan *model.Matter
	done func(uid int64, alias string) (*model.Matter, error)

	sStorage *service.Storage
}

func NewWorker() *Worker {
	return &Worker{
		ch: make(chan *model.Matter),

		sStorage: service.NewStorage(),
	}
}

func (w *Worker) WaitDone(m *model.Matter, f func(uid int64, alias string) (*model.Matter, error)) {
	w.ch <- m
	w.done = f
}

func (w *Worker) Run() error {
	for m := range w.ch {
		go w.waitDone(m)
	}

	return nil
}

func (w *Worker) waitDone(m *model.Matter) {
	provider, err := w.sStorage.GetProvider(m.Sid)
	if err != nil {
		return
	}

	for {
		s := time.Now()
		if _, err := provider.Head(m.Object); err != nil {
			// 加一个时间限制，控制请求频率
			if time.Now().Sub(s).Seconds() < maxHeadIntervalSec {
				time.Sleep(time.Second * time.Duration(rand.Intn(maxHeadIntervalSec)))
			}
			continue
		}

		w.done(m.Uid, m.Alias)
		fmt.Printf("object %s uploaed\n", m.Object)
		return
	}
}
