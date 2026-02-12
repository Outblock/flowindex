const request = async (path: string) => {
  return await (await fetch(`${process.env.HOST}${path}`)).text()
}
export const queryScript = async (fcl: any, path: string, args = []) => {
  const code = await request(`/scripts/stableCadence/${path}.cdc`)

  const result = await fcl.query({
    cadence: code,
    args: args
  })
  
  return result
}
