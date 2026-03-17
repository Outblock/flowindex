// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title VerifyingPaymaster for EntryPoint v0.7
 * @notice Simplified paymaster that sponsors gas if a trusted signer approves the UserOp.
 * Adapted from eth-infinitism/account-abstraction VerifyingPaymaster.
 */
interface IEntryPointV07 {
    function getNonce(address sender, uint192 key) external view returns (uint256);
}

interface IPaymaster {
    enum PostOpMode { opSucceeded, opReverted, postOpReverted }
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

contract VerifyingPaymaster {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    address public immutable entryPoint;
    address public immutable verifyingSigner;
    address public owner;

    uint256 private constant VALID_TIMESTAMP_OFFSET = 52;
    uint256 private constant SIGNATURE_OFFSET = 116;

    event Deposited(uint256 amount);
    event Staked(uint256 amount, uint32 unstakeDelay);

    constructor(address _entryPoint, address _verifyingSigner) {
        entryPoint = _entryPoint;
        verifyingSigner = _verifyingSigner;
        owner = msg.sender;
    }

    /**
     * @notice Compute the hash that the signer must sign to approve a UserOp.
     */
    function getHash(
        PackedUserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter
    ) public view returns (bytes32) {
        return keccak256(abi.encode(
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.initCode),
            keccak256(userOp.callData),
            userOp.accountGasLimits,
            userOp.preVerificationGas,
            userOp.gasFees,
            block.chainid,
            address(this),
            validUntil,
            validAfter
        ));
    }

    /**
     * @notice Deposit FLOW to EntryPoint for gas sponsoring.
     */
    function deposit() external payable {
        (bool ok,) = entryPoint.call{value: msg.value}(abi.encodeWithSignature("depositTo(address)", address(this)));
        require(ok, "deposit failed");
        emit Deposited(msg.value);
    }

    /**
     * @notice Stake FLOW at EntryPoint (required for paymasters).
     */
    function addStake(uint32 unstakeDelaySec) external payable {
        require(msg.sender == owner, "only owner");
        (bool ok,) = entryPoint.call{value: msg.value}(
            abi.encodeWithSignature("addStake(uint32)", unstakeDelaySec)
        );
        require(ok, "stake failed");
        emit Staked(msg.value, unstakeDelaySec);
    }

    /**
     * @notice Withdraw deposit from EntryPoint.
     */
    function withdrawTo(address payable to, uint256 amount) external {
        require(msg.sender == owner, "only owner");
        (bool ok,) = entryPoint.call(
            abi.encodeWithSignature("withdrawTo(address,uint256)", to, amount)
        );
        require(ok, "withdraw failed");
    }

    receive() external payable {}
}
