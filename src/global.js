/*
 * 全局能力配置
 */

function getGlobalRef() {
  return Object.getPrototypeOf(global) || global
}

const quickappGlobal = getGlobalRef()

function setGlobalData(key, val) {
  quickappGlobal[key] = val
}

function getGlobalData(key) {
  return quickappGlobal[key]
}

setGlobalData('setGlobalData', setGlobalData)
setGlobalData('getGlobalData', getGlobalData)

export { setGlobalData, getGlobalData }
