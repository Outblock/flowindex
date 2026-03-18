/** Virtual file system for multi-file Cadence projects.
 * Stores files in localStorage, keyed by project name. */

import { NETWORK_CONFIG, type FlowNetwork } from '../flow/networks';

export interface FileEntry {
  path: string;        // e.g. "main.cdc", "contracts/MyToken.cdc"
  content: string;
  readOnly?: boolean;  // true for dependency files
  language?: string;   // default: 'cadence'
}

export interface ProjectState {
  files: FileEntry[];
  activeFile: string;
  openFiles: string[];
  folders: string[]; // e.g. "contracts", "contracts/interfaces"
}

const STORAGE_KEY = 'runner:project';

export const DEFAULT_CODE = `// Welcome to Flow Runner — Cadence & Solidity
// Press Ctrl/Cmd+Enter to execute
// Create a .sol file to write Solidity for Flow EVM

access(all) fun main(): String {
    return "Hello, Flow!"
}
`;

export interface Template {
  label: string;
  description: string;
  icon: string;
  files: FileEntry[];
  activeFile: string;
  folders?: string[];
}

/**
 * Replace well-known Flow contract addresses in code for the given network.
 * Templates use mainnet addresses by default; this swaps them for testnet when needed.
 */
/** Well-known Flow contract addresses per network. */
const CONTRACT_ADDRESSES: Record<string, Record<FlowNetwork, string>> = {
  NonFungibleToken:          { mainnet: '0x1d7e57aa55817448', testnet: '0x631e88ae7f1d7c20' },
  FungibleToken:             { mainnet: '0xf233dcee88fe0abe', testnet: '0x9a0766d93b6608b7' },
  MetadataViews:             { mainnet: '0x1d7e57aa55817448', testnet: '0x631e88ae7f1d7c20' },
  ViewResolver:              { mainnet: '0x1d7e57aa55817448', testnet: '0x631e88ae7f1d7c20' },
  FlowToken:                 { mainnet: '0x1654653399040a61', testnet: '0x7e60df042a9c0868' },
  FlowFees:                  { mainnet: '0xf919ee77447b7497', testnet: '0x912d5440f7e3769e' },
  EVM:                       { mainnet: '0xe467b9dd11fa00df', testnet: '0x8c5303eaa26202d6' },
  FlowEVMBridge:             { mainnet: '0x1e4aa0b87d10b141', testnet: '0xdfc20aee650fcbdf' },
  NFTCatalog:                { mainnet: '0x49a7cda3a1eecc29', testnet: '0x324c34e1c517e4db' },
  NFTRetrieval:              { mainnet: '0x49a7cda3a1eecc29', testnet: '0x324c34e1c517e4db' },
  NFTStorefrontV2:           { mainnet: '0x4eb8a10cb9f87357', testnet: '0x2d55b98eb200daef' },
  Find:                      { mainnet: '0x097bafa4e0b48eef', testnet: '0xa16ab1d0abde3625' },
  Flowns:                    { mainnet: '0x233eb012d34b0070', testnet: '0xb05b2abb42335e88' },
  Domains:                   { mainnet: '0x233eb012d34b0070', testnet: '0xb05b2abb42335e88' },
  FlowIDTableStaking:        { mainnet: '0x8624b52f9ddcd04a', testnet: '0x9eca2b38b18b5dfe' },
  FlowStakingCollection:     { mainnet: '0x8d0e87b65159ae63', testnet: '0x95e019a17d0e23d7' },
  LockedTokens:              { mainnet: '0x8d0e87b65159ae63', testnet: '0x8d0e87b65159ae63' },
  FlowEpoch:                 { mainnet: '0x8624b52f9ddcd04a', testnet: '0x9eca2b38b18b5dfe' },
  FlowClusterQC:             { mainnet: '0x8624b52f9ddcd04a', testnet: '0x9eca2b38b18b5dfe' },
  HybridCustody:             { mainnet: '0xd8a7e05a7ac670c0', testnet: '0x294e44e1ec6993c6' },
  CapabilityFactory:         { mainnet: '0xd8a7e05a7ac670c0', testnet: '0x294e44e1ec6993c6' },
  CapabilityFilter:          { mainnet: '0xd8a7e05a7ac670c0', testnet: '0x294e44e1ec6993c6' },
  TransactionGeneration:     { mainnet: '0xe52522745adf5c34', testnet: '0x830c495357676f8b' },
  StringUtils:               { mainnet: '0xa340dc0a4ec828ab', testnet: '0x31ad40c07a2a9788' },
  FlowviewAccountBookmark:   { mainnet: '0x39b144ab4d348e2b', testnet: '0xdc34f5a7b807bcfb' },
  FungibleTokenSwitchboard:  { mainnet: '0xf233dcee88fe0abe', testnet: '0x9a0766d93b6608b7' },
  FungibleTokenMetadataViews:{ mainnet: '0xf233dcee88fe0abe', testnet: '0x9a0766d93b6608b7' },
  Burner:                    { mainnet: '0xf233dcee88fe0abe', testnet: '0x9a0766d93b6608b7' },
};

export function replaceContractAddresses(code: string, network: FlowNetwork): string {
  let result = code;
  for (const [name, addrs] of Object.entries(CONTRACT_ADDRESSES)) {
    // Replace `import X from 0x<mainnet>` → `import X from 0x<target>`
    // and `import X from 0x<testnet>` → `import X from 0x<target>`
    const target = addrs[network];
    for (const net of ['mainnet', 'testnet'] as const) {
      if (net === network) continue;
      result = result.replaceAll(addrs[net], target);
    }
  }
  return result;
}

export function getTemplates(network: FlowNetwork): Template[] {
  return TEMPLATES.map(t => ({
    ...t,
    files: t.files.map(f => ({
      ...f,
      content: replaceContractAddresses(f.content, network),
    })),
  }));
}

export const TEMPLATES: Template[] = [
  {
    label: 'Hello World',
    description: 'Simple script that returns a string',
    icon: 'wave',
    files: [{ path: 'main.cdc', content: DEFAULT_CODE }],
    activeFile: 'main.cdc',
  },
  {
    label: 'Query Account Balance',
    description: 'Check FLOW balance of any address',
    icon: 'search',
    files: [{
      path: 'main.cdc',
      content: `import FungibleToken from 0xf233dcee88fe0abe

access(all) fun main(address: Address): UFix64 {
    let account = getAccount(address)
    let vaultRef = account.capabilities
        .borrow<&{FungibleToken.Balance}>(/public/flowTokenBalance)
        ?? panic("Could not borrow Balance capability")
    return vaultRef.balance
}
`,
    }],
    activeFile: 'main.cdc',
  },
  {
    label: 'Query NFT Collection',
    description: 'List NFT IDs in a collection',
    icon: 'image',
    files: [{
      path: 'main.cdc',
      content: `import NonFungibleToken from 0x1d7e57aa55817448

access(all) fun main(address: Address, storagePath: String): [UInt64] {
    let account = getAuthAccount<auth(Storage) &Account>(address)
    let path = StoragePath(identifier: storagePath)
        ?? panic("Invalid storage path")
    if let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: path) {
        return collection.getIDs()
    }
    return []
}
`,
    }],
    activeFile: 'main.cdc',
  },
  {
    label: 'Create Fungible Token',
    description: 'Define a basic FT contract',
    icon: 'coins',
    files: [{
      path: 'MyToken.cdc',
      content: `import FungibleToken from 0xf233dcee88fe0abe

access(all) contract MyToken: FungibleToken {

    access(all) var totalSupply: UFix64

    access(all) resource Vault: FungibleToken.Vault {
        access(all) var balance: UFix64

        init(balance: UFix64) {
            self.balance = balance
        }

        access(FungibleToken.Withdraw) fun withdraw(amount: UFix64): @{FungibleToken.Vault} {
            self.balance = self.balance - amount
            return <- create Vault(balance: amount)
        }

        access(all) fun deposit(from: @{FungibleToken.Vault}) {
            let vault <- from as! @MyToken.Vault
            self.balance = self.balance + vault.balance
            vault.balance = 0.0
            destroy vault
        }

        access(all) fun createEmptyVault(): @{FungibleToken.Vault} {
            return <- create Vault(balance: 0.0)
        }

        access(all) view fun isAvailableToWithdraw(amount: UFix64): Bool {
            return self.balance >= amount
        }

        access(all) view fun getViews(): [Type] {
            return []
        }

        access(all) fun resolveView(_ view: Type): AnyStruct? {
            return nil
        }
    }

    access(all) fun createEmptyVault(vaultType: Type): @{FungibleToken.Vault} {
        return <- create Vault(balance: 0.0)
    }

    access(all) view fun getContractViews(resourceType: Type?): [Type] {
        return []
    }

    access(all) fun resolveContractView(resourceType: Type?, viewType: Type): AnyStruct? {
        return nil
    }

    init() {
        self.totalSupply = 1000000.0
    }
}
`,
    }],
    activeFile: 'MyToken.cdc',
  },
  {
    label: 'Create NFT Collection',
    description: 'Define a basic NFT contract',
    icon: 'image-plus',
    files: [{
      path: 'MyNFT.cdc',
      content: `import NonFungibleToken from 0x1d7e57aa55817448
import MetadataViews from 0x1d7e57aa55817448

access(all) contract MyNFT: NonFungibleToken {

    access(all) var totalSupply: UInt64

    access(all) event ContractInitialized()
    access(all) event Withdraw(id: UInt64, from: Address?)
    access(all) event Deposit(id: UInt64, to: Address?)

    access(all) resource NFT: NonFungibleToken.NFT {
        access(all) let id: UInt64
        access(all) let name: String
        access(all) let description: String
        access(all) let thumbnail: String

        init(name: String, description: String, thumbnail: String) {
            self.id = MyNFT.totalSupply
            self.name = name
            self.description = description
            self.thumbnail = thumbnail
            MyNFT.totalSupply = MyNFT.totalSupply + 1
        }

        access(all) fun createEmptyCollection(): @{NonFungibleToken.Collection} {
            return <- MyNFT.createEmptyCollection(nftType: Type<@MyNFT.NFT>())
        }

        access(all) view fun getViews(): [Type] {
            return [Type<MetadataViews.Display>()]
        }

        access(all) fun resolveView(_ view: Type): AnyStruct? {
            switch view {
                case Type<MetadataViews.Display>():
                    return MetadataViews.Display(
                        name: self.name,
                        description: self.description,
                        thumbnail: MetadataViews.HTTPFile(url: self.thumbnail)
                    )
            }
            return nil
        }
    }

    access(all) resource Collection: NonFungibleToken.Collection {
        access(all) var ownedNFTs: @{UInt64: {NonFungibleToken.NFT}}

        init() {
            self.ownedNFTs <- {}
        }

        access(all) view fun getIDs(): [UInt64] {
            return self.ownedNFTs.keys
        }

        access(all) view fun borrowNFT(_ id: UInt64): &{NonFungibleToken.NFT}? {
            return &self.ownedNFTs[id]
        }

        access(NonFungibleToken.Withdraw) fun withdraw(withdrawID: UInt64): @{NonFungibleToken.NFT} {
            let token <- self.ownedNFTs.remove(key: withdrawID)
                ?? panic("NFT not found in collection")
            return <- token
        }

        access(all) fun deposit(token: @{NonFungibleToken.NFT}) {
            let nft <- token as! @MyNFT.NFT
            self.ownedNFTs[nft.id] <-! nft
        }

        access(all) fun createEmptyCollection(): @{NonFungibleToken.Collection} {
            return <- create Collection()
        }

        access(all) view fun getSupportedNFTTypes(): {Type: Bool} {
            return { Type<@MyNFT.NFT>(): true }
        }

        access(all) view fun isSupportedNFTType(type: Type): Bool {
            return type == Type<@MyNFT.NFT>()
        }
    }

    access(all) fun createEmptyCollection(nftType: Type): @{NonFungibleToken.Collection} {
        return <- create Collection()
    }

    access(all) view fun getContractViews(resourceType: Type?): [Type] {
        return [Type<MetadataViews.NFTCollectionDisplay>()]
    }

    access(all) fun resolveContractView(resourceType: Type?, viewType: Type): AnyStruct? {
        return nil
    }

    init() {
        self.totalSupply = 0
        emit ContractInitialized()
    }
}
`,
    }],
    activeFile: 'MyNFT.cdc',
  },
  {
    label: 'Send FLOW Transaction',
    description: 'Transfer FLOW tokens to another address',
    icon: 'send',
    files: [{
      path: 'main.cdc',
      content: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

transaction(amount: UFix64, recipient: Address) {

    let sentVault: @{FungibleToken.Vault}

    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow reference to the owner's Vault")
        self.sentVault <- vaultRef.withdraw(amount: amount)
    }

    execute {
        let receiverRef = getAccount(recipient)
            .capabilities.borrow<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            ?? panic("Could not borrow receiver reference")
        receiverRef.deposit(from: <- self.sentVault)
    }
}
`,
    }],
    activeFile: 'main.cdc',
  },
  {
    label: 'Simple Storage (Solidity)',
    description: 'Store and retrieve a value on Flow EVM',
    icon: 'database',
    files: [{
      path: 'SimpleStorage.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SimpleStorage {
    uint256 private storedValue;

    event ValueChanged(uint256 newValue);

    function set(uint256 value) public {
        storedValue = value;
        emit ValueChanged(value);
    }

    function get() public view returns (uint256) {
        return storedValue;
    }
}
`,
      language: 'sol',
    }],
    activeFile: 'SimpleStorage.sol',
  },
  {
    label: 'ERC-20 Token (Solidity)',
    description: 'Basic ERC-20 token on Flow EVM',
    icon: 'coins',
    files: [{
      path: 'MyToken.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MyToken {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply * 10 ** decimals;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
`,
      language: 'sol',
    }],
    activeFile: 'MyToken.sol',
  },
  {
    label: 'Cross-VM (Cadence + EVM)',
    description: 'Call a Solidity contract from Cadence via EVM.run()',
    icon: 'arrow-left-right',
    files: [
      {
        path: 'Counter.sol',
        content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public count;

    function increment() public {
        count += 1;
    }

    function getCount() public view returns (uint256) {
        return count;
    }
}
`,
        language: 'sol',
      },
      {
        path: 'call_evm.cdc',
        content: `import EVM from 0xe467b9dd11fa00df

/// Call a deployed Solidity contract on Flow EVM from Cadence.
/// Replace the contract address with your deployed Counter address.
access(all) fun main(): UInt256 {
    let contractAddress = EVM.addressFromString("0x0000000000000000000000000000000000000000")

    // ABI-encoded calldata for getCount() — selector: 0xa87d942c
    let calldata: [UInt8] = [0xa8, 0x7d, 0x94, 0x2c]

    let result = EVM.dryCall(
        from: contractAddress,
        to: contractAddress,
        data: calldata,
        gasLimit: 300000,
        value: EVM.Balance(attoflow: 0)
    )

    // Decode the returned uint256
    let decoded = EVM.decodeABI(types: [Type<UInt256>()], data: result.data)
    return decoded[0] as! UInt256
}
`,
      },
    ],
    activeFile: 'call_evm.cdc',
    folders: [],
  },
  {
    label: 'ERC-721 NFT (Solidity)',
    description: 'Minimal NFT contract on Flow EVM',
    icon: 'image',
    files: [{
      path: 'MyNFT.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MyNFT {
    string public name;
    string public symbol;
    uint256 private _tokenIdCounter;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(uint256 => string) private _tokenURIs;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, string memory tokenURI) public returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _owners[tokenId] = to;
        _balances[to] += 1;
        _tokenURIs[tokenId] = tokenURI;
        emit Transfer(address(0), to, tokenId);
        return tokenId;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "Token does not exist");
        return owner;
    }

    function balanceOf(address owner) public view returns (uint256) {
        require(owner != address(0), "Zero address");
        return _balances[owner];
    }

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return _tokenURIs[tokenId];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_owners[tokenId] == from, "Not owner");
        require(msg.sender == from || msg.sender == _tokenApprovals[tokenId], "Not authorized");
        _owners[tokenId] = to;
        _balances[from] -= 1;
        _balances[to] += 1;
        delete _tokenApprovals[tokenId];
        emit Transfer(from, to, tokenId);
    }

    function approve(address to, uint256 tokenId) public {
        require(msg.sender == _owners[tokenId], "Not owner");
        _tokenApprovals[tokenId] = to;
        emit Approval(msg.sender, to, tokenId);
    }
}
`,
      language: 'sol',
    }],
    activeFile: 'MyNFT.sol',
  },
  {
    label: 'Multi-Sig Wallet (Solidity)',
    description: 'Simple multi-signature wallet',
    icon: 'shield',
    files: [{
      path: 'MultiSigWallet.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;
    mapping(address => bool) public isOwner;

    event Submit(uint256 indexed txId, address indexed owner, address to, uint256 value);
    event Confirm(uint256 indexed txId, address indexed owner);
    event Execute(uint256 indexed txId);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submit(address _to, uint256 _value, bytes calldata _data) external onlyOwner returns (uint256) {
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction(_to, _value, _data, false, 0);
        emit Submit(txId, msg.sender, _to, _value);
        return txId;
    }

    function confirm(uint256 _txId) external onlyOwner {
        require(!isConfirmed[_txId][msg.sender], "Already confirmed");
        isConfirmed[_txId][msg.sender] = true;
        transactions[_txId].confirmations += 1;
        emit Confirm(_txId, msg.sender);
    }

    function execute(uint256 _txId) external onlyOwner {
        Transaction storage txn = transactions[_txId];
        require(!txn.executed, "Already executed");
        require(txn.confirmations >= required, "Not enough confirmations");
        txn.executed = true;
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");
        emit Execute(_txId);
    }

    receive() external payable {}
}
`,
      language: 'sol',
    }],
    activeFile: 'MultiSigWallet.sol',
  },
  {
    label: 'Staking Vault (Solidity)',
    description: 'Stake tokens and earn rewards',
    icon: 'vault',
    files: [{
      path: 'StakingVault.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract StakingVault {
    address public owner;
    uint256 public rewardRate; // reward per second per token staked (scaled by 1e18)

    struct StakeInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lastStakedAt;
    }

    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 reward);

    constructor(uint256 _rewardRate) {
        owner = msg.sender;
        rewardRate = _rewardRate;
    }

    function stake() external payable {
        require(msg.value > 0, "Cannot stake 0");
        StakeInfo storage info = stakes[msg.sender];
        if (info.amount > 0) {
            uint256 pending = _pendingReward(msg.sender);
            info.rewardDebt += pending;
        }
        info.amount += msg.value;
        info.lastStakedAt = block.timestamp;
        totalStaked += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    function withdraw(uint256 _amount) external {
        StakeInfo storage info = stakes[msg.sender];
        require(info.amount >= _amount, "Insufficient stake");
        uint256 pending = _pendingReward(msg.sender);
        info.rewardDebt += pending;
        info.amount -= _amount;
        info.lastStakedAt = block.timestamp;
        totalStaked -= _amount;
        payable(msg.sender).transfer(_amount);
        emit Withdrawn(msg.sender, _amount);
    }

    function claimReward() external {
        uint256 reward = _pendingReward(msg.sender) + stakes[msg.sender].rewardDebt;
        require(reward > 0, "No reward");
        stakes[msg.sender].rewardDebt = 0;
        stakes[msg.sender].lastStakedAt = block.timestamp;
        payable(msg.sender).transfer(reward);
        emit RewardClaimed(msg.sender, reward);
    }

    function _pendingReward(address _user) internal view returns (uint256) {
        StakeInfo storage info = stakes[_user];
        if (info.amount == 0) return 0;
        uint256 elapsed = block.timestamp - info.lastStakedAt;
        return (info.amount * rewardRate * elapsed) / 1e18;
    }

    function pendingReward(address _user) external view returns (uint256) {
        return _pendingReward(_user) + stakes[_user].rewardDebt;
    }

    receive() external payable {}
}
`,
      language: 'sol',
    }],
    activeFile: 'StakingVault.sol',
  },
];

function defaultProject(): ProjectState {
  return {
    files: [{ path: 'main.cdc', content: DEFAULT_CODE }],
    activeFile: 'main.cdc',
    openFiles: ['main.cdc'],
    folders: [],
  };
}

function normalizeBasePath(path: string): string {
  return path
    .trim()
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
}

function isInvalidUserPath(path: string): boolean {
  return !path || path.startsWith('/') || path.includes('..') || path.startsWith('deps/');
}

function normalizeFilePath(path: string): string | null {
  const normalized = normalizeBasePath(path).replace(/\/+$/, '');
  if (isInvalidUserPath(normalized)) return null;
  return normalized;
}

function normalizeFolderPath(path: string): string | null {
  const normalized = normalizeBasePath(path).replace(/\/+$/, '');
  if (isInvalidUserPath(normalized)) return null;
  return normalized;
}

function getParentFolders(path: string): string[] {
  const parts = path.split('/');
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

function sanitizeProject(parsed: Partial<ProjectState>): ProjectState {
  const files = Array.isArray(parsed.files)
    ? parsed.files.filter((f): f is FileEntry => {
        return !!f && typeof f.path === 'string' && typeof f.content === 'string';
      })
    : [];

  if (files.length === 0) return defaultProject();

  const validPaths = new Set(files.map((f) => f.path));
  const activeFile = typeof parsed.activeFile === 'string' && validPaths.has(parsed.activeFile)
    ? parsed.activeFile
    : files[0].path;

  const openFilesRaw = Array.isArray(parsed.openFiles)
    ? parsed.openFiles.filter((p): p is string => typeof p === 'string' && validPaths.has(p))
    : [];
  const openFiles = openFilesRaw.length > 0
    ? Array.from(new Set(openFilesRaw))
    : [activeFile];

  const persistedFolders = Array.isArray(parsed.folders)
    ? parsed.folders
        .map((folder) => normalizeFolderPath(String(folder)))
        .filter((folder): folder is string => !!folder)
    : [];

  return {
    files,
    activeFile,
    openFiles: openFiles.includes(activeFile) ? openFiles : [...openFiles, activeFile],
    folders: Array.from(new Set(persistedFolders)).sort(),
  };
}

export function loadProject(): ProjectState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProjectState>;
      return sanitizeProject(parsed);
    }
  } catch { /* ignore */ }
  return defaultProject();
}

export function saveProject(state: ProjectState) {
  // Only save non-readOnly files (deps are resolved on demand)
  const toSave: ProjectState = {
    ...state,
    files: state.files.filter((f) => !f.readOnly),
    folders: (state.folders || [])
      .map((folder) => normalizeFolderPath(folder))
      .filter((folder): folder is string => !!folder),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded, ignore */ }
}

function stripReadOnlyFiles(state: ProjectState): ProjectState {
  return {
    ...state,
    files: state.files.filter((f) => !f.readOnly),
    folders: (state.folders || [])
      .map((folder) => normalizeFolderPath(folder))
      .filter((folder): folder is string => !!folder),
  };
}

// ── Local project management (anonymous / offline) ──

export interface LocalProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
}

const LOCAL_INDEX_KEY = 'runner:local-project-index';
const LOCAL_PREFIX = 'runner:local:';
const CLOUD_META_KEY = 'runner:cloudMeta';

export function generateLocalId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export function listLocalProjects(): LocalProjectMeta[] {
  try {
    const raw = localStorage.getItem(LOCAL_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveLocalIndex(list: LocalProjectMeta[]) {
  try { localStorage.setItem(LOCAL_INDEX_KEY, JSON.stringify(list)); } catch {}
}

export function saveLocalProject(id: string, state: ProjectState, name: string) {
  const toSave = stripReadOnlyFiles(state);
  try { localStorage.setItem(LOCAL_PREFIX + id, JSON.stringify(toSave)); } catch {}
  const list = listLocalProjects();
  const idx = list.findIndex(p => p.id === id);
  const meta: LocalProjectMeta = { id, name, updatedAt: new Date().toISOString() };
  if (idx >= 0) list[idx] = meta; else list.unshift(meta);
  saveLocalIndex(list);
}

export function loadLocalProject(id: string): ProjectState | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + id);
    if (raw) return sanitizeProject(JSON.parse(raw));
  } catch {}
  return null;
}

export function deleteLocalProject(id: string) {
  try { localStorage.removeItem(LOCAL_PREFIX + id); } catch {}
  saveLocalIndex(listLocalProjects().filter(p => p.id !== id));
}

export function renameLocalProject(id: string, name: string) {
  const list = listLocalProjects();
  const idx = list.findIndex(p => p.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], name };
    saveLocalIndex(list);
  }
}

// ── Cloud meta persistence (survives page refresh) ──

export function loadCloudMeta(): { id?: string; name: string; slug?: string; is_public?: boolean } | null {
  try {
    const raw = localStorage.getItem(CLOUD_META_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveCloudMeta(meta: { id?: string; name: string; slug?: string; is_public?: boolean }) {
  try { localStorage.setItem(CLOUD_META_KEY, JSON.stringify(meta)); } catch {}
}

export function clearCloudMeta() {
  try { localStorage.removeItem(CLOUD_META_KEY); } catch {}
}

export function getFileContent(state: ProjectState, path: string): string | undefined {
  return state.files.find((f) => f.path === path)?.content;
}

export function updateFileContent(state: ProjectState, path: string, content: string): ProjectState {
  return {
    ...state,
    files: state.files.map((f) => (f.path === path ? { ...f, content } : f)),
  };
}

export function createFile(state: ProjectState, path: string, content = ''): ProjectState {
  const normalizedPath = normalizeFilePath(path);
  if (!normalizedPath) return state;
  if (state.files.some((f) => f.path === normalizedPath)) return state;

  const folderSet = new Set(state.folders || []);
  for (const folder of getParentFolders(normalizedPath)) {
    folderSet.add(folder);
  }

  return {
    ...state,
    files: [...state.files, { path: normalizedPath, content }],
    openFiles: [...state.openFiles, normalizedPath],
    activeFile: normalizedPath,
    folders: Array.from(folderSet).sort(),
  };
}

export function createFolder(state: ProjectState, path: string): ProjectState {
  const normalizedFolder = normalizeFolderPath(path);
  if (!normalizedFolder) return state;

  const folderSet = new Set(state.folders || []);
  for (const folder of getParentFolders(`${normalizedFolder}/__placeholder__`)) {
    if (folder.endsWith('/__placeholder__')) continue;
    folderSet.add(folder);
  }
  folderSet.add(normalizedFolder);

  return {
    ...state,
    folders: Array.from(folderSet).sort(),
  };
}

export function deleteFile(state: ProjectState, path: string): ProjectState {
  const files = state.files.filter((f) => f.path !== path);
  const openFiles = state.openFiles.filter((f) => f !== path);
  let activeFile = state.activeFile;
  if (activeFile === path) {
    activeFile = openFiles[0] || files[0]?.path || '';
  }
  return { ...state, files, openFiles, activeFile };
}

export function renameFile(state: ProjectState, oldPath: string, newPath: string): ProjectState {
  const normalizedNew = normalizeFilePath(newPath);
  if (!normalizedNew || normalizedNew === oldPath) return state;
  if (state.files.some((f) => f.path === normalizedNew)) return state;

  // Ensure parent folders exist for the new path
  const folderSet = new Set(state.folders || []);
  for (const folder of getParentFolders(normalizedNew)) {
    folderSet.add(folder);
  }

  return {
    ...state,
    files: state.files.map((f) => (f.path === oldPath ? { ...f, path: normalizedNew } : f)),
    openFiles: state.openFiles.map((f) => (f === oldPath ? normalizedNew : f)),
    activeFile: state.activeFile === oldPath ? normalizedNew : state.activeFile,
    folders: Array.from(folderSet).sort(),
  };
}

export function moveFile(state: ProjectState, filePath: string, targetFolder: string): ProjectState {
  const fileName = filePath.split('/').pop() || filePath;
  const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
  return renameFile(state, filePath, newPath);
}

export function openFile(state: ProjectState, path: string): ProjectState {
  const openFiles = state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path];
  return { ...state, openFiles, activeFile: path };
}

export function closeFile(state: ProjectState, path: string): ProjectState {
  const openFiles = state.openFiles.filter((f) => f !== path);
  let activeFile = state.activeFile;
  if (activeFile === path) {
    const idx = state.openFiles.indexOf(path);
    activeFile = openFiles[Math.min(idx, openFiles.length - 1)] || '';
  }
  return { ...state, openFiles, activeFile };
}

/** Add a resolved dependency file (read-only, in deps/ folder) */
export function addDependencyFile(state: ProjectState, address: string, contractName: string, code: string): ProjectState {
  const path = `deps/${address}/${contractName}.cdc`;
  const existing = state.files.find((f) => f.path === path);
  if (existing) {
    // Update content if changed
    if (existing.content === code) return state;
    return {
      ...state,
      files: state.files.map((f) => (f.path === path ? { ...f, content: code } : f)),
    };
  }
  return {
    ...state,
    files: [...state.files, { path, content: code, readOnly: true }],
  };
}

/** Get all user files (non-dependency) */
export function getUserFiles(state: ProjectState): FileEntry[] {
  return state.files.filter((f) => !f.readOnly && !f.path.startsWith('deps/'));
}

/** Get all dependency files */
export function getDependencyFiles(state: ProjectState): FileEntry[] {
  return state.files.filter((f) => f.readOnly || f.path.startsWith('deps/'));
}

/** Build a folder tree structure from flat file list */
export interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  readOnly?: boolean;
  children: TreeNode[];
}

function ensureFolderPath(root: TreeNode[], folderPath: string, readOnly = false): void {
  const parts = folderPath.split('/').filter(Boolean);
  let current = root;

  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i];
    const path = parts.slice(0, i + 1).join('/');
    let folder = current.find((node) => node.isFolder && node.path === path);
    if (!folder) {
      folder = { name, path, isFolder: true, readOnly, children: [] };
      current.push(folder);
    } else if (!readOnly) {
      folder.readOnly = false;
    }
    current = folder.children;
  }
}

export function buildTree(files: FileEntry[], folders: string[] = []): TreeNode[] {
  const root: TreeNode[] = [];

  for (const folderPath of folders) {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) continue;
    ensureFolderPath(root, normalized, false);
  }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    const parent = parts.slice(0, -1).join('/');
    if (parent) {
      ensureFolderPath(root, parent, !!file.readOnly);
    }

    let current = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const folderPath = parts.slice(0, i + 1).join('/');
      const folder = current.find((node) => node.isFolder && node.path === folderPath);
      if (!folder) break;
      current = folder.children;
    }

    const fileName = parts[parts.length - 1];
    const existingFile = current.find((node) => !node.isFolder && node.path === file.path);
    if (!existingFile) {
      current.push({ name: fileName, path: file.path, isFolder: false, readOnly: file.readOnly, children: [] });
    }
  }

  // Sort: folders first, then files, alphabetically
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => { if (n.isFolder) sortNodes(n.children); });
  };
  sortNodes(root);

  return root;
}
