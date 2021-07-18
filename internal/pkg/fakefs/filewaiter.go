package fakefs

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/provider"
)

const maxHeadIntervalSec = 5

type AutoDoneMsg struct {
	Provider provider.Provider
	Matter   *model.Matter
	Handler  func(uid int64, alias string) (*model.Matter, error)
}

type FileWaiter struct {
	ch chan *AutoDoneMsg
}

func NewFileWaiter() *FileWaiter {
	return &FileWaiter{
		ch: make(chan *AutoDoneMsg),
	}
}

func (w *FileWaiter) Run() error {
	for m := range w.ch {
		go w.runWait(m)
	}

	return nil
}

// fixme: 如果在外链上传期间服务重启了，将永远无法标记上传完成

func (w *FileWaiter) Wait(p provider.Provider, m *model.Matter, f func(uid int64, alias string) (*model.Matter, error)) {
	w.ch <- &AutoDoneMsg{Provider: p, Matter: m, Handler: f}
}

func (w *FileWaiter) runWait(adm *AutoDoneMsg) {
	startAt := time.Now()
	for {
		// 如果超过上传有效期仍然没有上传完成则判定为失败，不再等待
		if startAt.Sub(time.Now()) > time.Hour {
			break
		}

		s := time.Now()
		if _, err := adm.Provider.Head(adm.Matter.Object); err != nil {
			// 加一个时间限制，控制请求频率
			if time.Now().Sub(s).Seconds() < maxHeadIntervalSec {
				time.Sleep(time.Second * time.Duration(rand.Intn(maxHeadIntervalSec)))
			}
			continue
		}

		adm.Handler(adm.Matter.Uid, adm.Matter.Alias)
		fmt.Printf("object %s uploaed\n", adm.Matter.Object)
		return
	}
}
