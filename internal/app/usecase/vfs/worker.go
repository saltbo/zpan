package vfs

import (
	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/sourcegraph/conc/pool"
)

const (
	EventActionCreated EventAction = "Created"
	EventActionDeleted EventAction = "Deleted"
)

type (
	EventAction  string
	EventHandler func(matter *entity.Matter) error
)

type Event struct {
	Action EventAction
	Matter *entity.Matter
}

type EventWorker struct {
	eventChan chan Event
	eventReg  map[EventAction]EventHandler
}

func NewWorker() *EventWorker {
	return &EventWorker{
		eventChan: make(chan Event),
		eventReg:  make(map[EventAction]EventHandler),
	}
}

func (w *EventWorker) Run() {
	p := pool.New().WithMaxGoroutines(10)
	for elem := range w.eventChan {
		eventHandle := w.eventReg[elem.Action]
		p.Go(func() {
			if err := eventHandle(elem.Matter); err != nil {
				return
			}
		})
	}
	p.Wait()
}

func (w *EventWorker) registerEventHandler(action EventAction, h EventHandler) {
	w.eventReg[action] = h
}

func (w *EventWorker) sendEvent(action EventAction, m *entity.Matter) {
	w.eventChan <- Event{Action: action, Matter: m}
}
