<script setup lang="ts">
function beforeEnter(element: Element) {
  const el = element as HTMLElement
  el.style.height = '0'
  el.style.opacity = '0'
}

function enter(element: Element) {
  const el = element as HTMLElement
  el.style.height = `${el.scrollHeight}px`
  el.style.opacity = '1'
}

function afterEnter(element: Element) {
  const el = element as HTMLElement
  el.style.height = 'auto'
  el.style.opacity = ''
}

function beforeLeave(element: Element) {
  const el = element as HTMLElement
  el.style.height = `${el.scrollHeight}px`
  el.style.opacity = '1'
}

function leave(element: Element) {
  const el = element as HTMLElement
  void el.offsetHeight
  el.style.height = '0'
  el.style.opacity = '0'
}

function afterLeave(element: Element) {
  const el = element as HTMLElement
  el.style.height = ''
  el.style.opacity = ''
}
</script>

<template>
  <Transition
    name="tree-collapse"
    @before-enter="beforeEnter"
    @enter="enter"
    @after-enter="afterEnter"
    @before-leave="beforeLeave"
    @leave="leave"
    @after-leave="afterLeave"
  >
    <slot></slot>
  </Transition>
</template>

<style>
.tree-collapse-enter-active,
.tree-collapse-leave-active {
  overflow: hidden;
  transition: height .2s ease, opacity .14s ease;
}

@media (prefers-reduced-motion: reduce) {
  .tree-collapse-enter-active,
  .tree-collapse-leave-active {
    transition: none;
  }
}
</style>
