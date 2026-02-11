import NonFungibleToken from 0xNonFungibleToken
import MetadataViews from 0xMetadataViews
import ViewResolver from 0xMetadataViews

access(all) fun main(address: Address): Int {
    let account = getAccount(address)
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    var count = 0

    fun eachPath(path: StoragePath, Type: Type): Bool {
        if Type != nil {
            if Type.isSubtype(of: collectionType) && !Type.isRecovered {
                let pathStr = path.toString()
                let splitArr = pathStr.split(separator: "/")
                let identifier = splitArr[2]

                var acc = getAuthAccount<auth(Storage) &Account>(address)
                var obj = acc.storage.borrow<&AnyResource>(from: StoragePath(identifier: identifier)!)!
                var meta = obj as? &{ViewResolver.ResolverCollection}
                count = count + meta!.getIDs().length
            }
        }
        return true
    }
    account.storage.forEachStored(eachPath)

    return count
}
